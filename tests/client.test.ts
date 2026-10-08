import { beforeEach, describe, expect, it } from 'vitest';
import {
  AnalysisParseError,
  GraphContextClient,
  InMemoryGraphStore,
  MockProvider,
  NotFoundError,
  ValidationError,
} from '../src/index.js';
import { followUp, kickoff, validAnalysisJson } from './fixtures.js';

describe('GraphContextClient', () => {
  let llm: MockProvider;
  let client: GraphContextClient;

  beforeEach(async () => {
    llm = new MockProvider(validAnalysisJson);
    client = new GraphContextClient({ graph: new InMemoryGraphStore(), llm });
    await client.init();
    await client.addConversation(kickoff);
  });

  it('addConversation validates, stores and returns the normalized conversation', async () => {
    const stored = await client.addConversation(followUp);
    expect(stored.id).toBe('c-followup');
    expect(await client.getConversation('c-followup')).toEqual(stored);
    await expect(client.addConversation({ participants: [], messages: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('analyzeConversation sends conversation + graph context to the LLM and returns structured results', async () => {
    await client.addConversation(followUp);
    const result = await client.analyzeConversation('c-followup', { instructions: 'Focus on deadlines' });

    expect(result.risks[0]!.type).toBe('conflicting-deadline');
    expect(result.provider).toEqual({ name: 'mock', model: 'mock' });

    const sent = llm.requests[0]!;
    expect(sent.responseFormat).toBe('json');
    expect(sent.temperature).toBe(0);
    const prompt = sent.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('[f2] Ben Cole (ben): I thought March was the plan.');
    // Graph context from the earlier conversation is included.
    expect(prompt).toContain('Ship onboarding in March');
    expect(prompt).toContain('Focus on deadlines');
  });

  it('throws NotFoundError for unknown conversations', async () => {
    await expect(client.analyzeConversation('missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.getContext('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('surfaces unparseable LLM output as AnalysisParseError', async () => {
    const bad = new GraphContextClient({ graph: client.graph, llm: new MockProvider('not json') });
    await expect(bad.analyzeConversation('c-kickoff')).rejects.toBeInstanceOf(AnalysisParseError);
  });

  it('does not persist analysis decisions by default', async () => {
    await client.addConversation(followUp);
    await client.analyzeConversation('c-followup');
    expect((await client.getConversation('c-followup'))!.decisions).toEqual([]);
  });

  it('persists new analysis decisions when asked, making them context for later conversations', async () => {
    await client.addConversation(followUp);
    await client.analyzeConversation('c-followup', { persistDecisions: true });

    const decisions = (await client.getConversation('c-followup'))!.decisions;
    expect(decisions).toEqual([
      {
        id: 'c-followup_analysis_dec_1',
        conversationId: 'c-followup',
        description: 'Ship onboarding by end of February',
        assignedTo: ['ben'],
        topicIds: [],
        source: 'analysis',
      },
    ]);
    const kickoffContext = await client.getContext('c-kickoff');
    expect(kickoffContext.relatedDecisions.map((d) => d.source)).toContain('analysis');
  });

  it('applies default context options from the constructor', async () => {
    const limited = new GraphContextClient({ graph: client.graph, llm, context: { maxRelatedDecisions: 0 } });
    await limited.addConversation(followUp);
    expect((await limited.getContext('c-followup')).relatedDecisions).toEqual([]);
  });
});
