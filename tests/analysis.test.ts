import { describe, expect, it } from 'vitest';
import { AnalysisParseError, buildAnalysisMessages, extractJson, normalizeConversation, parseAnalysis } from '../src/index.js';
import { followUp, validAnalysisJson } from './fixtures.js';

const conversation = normalizeConversation(followUp);
const provider = { name: 'test', model: 't-1' };

describe('extractJson', () => {
  it('parses plain JSON, fenced JSON, and JSON surrounded by prose', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
  });

  it('throws when there is no JSON object', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('parseAnalysis', () => {
  it('returns a typed result', () => {
    const result = parseAnalysis(validAnalysisJson, conversation, provider);
    expect(result.conversationId).toBe('c-followup');
    expect(result.risks[0]).toMatchObject({ type: 'conflicting-deadline', severity: 'high', evidenceMessageIds: ['f1', 'f2'] });
    expect(result.decisions[0]!.interpretations).toHaveLength(2);
    expect(result.provider).toEqual(provider);
  });

  it('fills defaults, normalizes severity case and accepts null owners', () => {
    const result = parseAnalysis(
      JSON.stringify({ summary: 's', decisions: [{ description: 'd', owner: null }], risks: [{ type: 't', description: 'd', severity: 'HIGH' }] }),
      conversation,
      provider,
    );
    expect(result.decisions[0]).toEqual({ description: 'd', owner: undefined, interpretations: [] });
    expect(result.risks[0]).toMatchObject({ severity: 'high', involvedPersonIds: [], evidenceMessageIds: [] });
    expect(result.suggestedClarifications).toEqual([]);
  });

  it('drops ids that are not in the conversation (hallucination guard)', () => {
    const result = parseAnalysis(
      JSON.stringify({
        summary: 's',
        decisions: [{ description: 'd', owner: 'zed', interpretations: [{ personId: 'zed', understanding: 'x' }] }],
        risks: [{ type: 't', description: 'd', severity: 'low', involvedPersonIds: ['ada', 'zed'], evidenceMessageIds: ['f1', 'f99'] }],
      }),
      conversation,
      provider,
    );
    expect(result.decisions[0]).toEqual({ description: 'd', owner: undefined, interpretations: [] });
    expect(result.risks[0]).toMatchObject({ involvedPersonIds: ['ada'], evidenceMessageIds: ['f1'] });
  });

  it('throws AnalysisParseError with the raw output for invalid JSON or schema', () => {
    const bad = 'I cannot help with that';
    const error = (() => {
      try {
        parseAnalysis(bad, conversation, provider);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(AnalysisParseError);
    expect((error as AnalysisParseError).rawOutput).toBe(bad);

    expect(() => parseAnalysis('{"summary": 1}', conversation, provider)).toThrow(/schema/);
    expect(() => parseAnalysis('{"summary":"s","risks":[{"type":"t","description":"d","severity":"extreme"}]}', conversation, provider)).toThrow(AnalysisParseError);
  });
});

describe('buildAnalysisMessages', () => {
  it('builds a system + user message pair with optional instructions', () => {
    const [system, user] = buildAnalysisMessages('CONTEXT', 'Focus on deadlines');
    expect(system!.role).toBe('system');
    expect(system!.content).toContain('"suggestedClarifications"');
    expect(user!.content).toContain('CONTEXT');
    expect(user!.content).toContain('Focus on deadlines');
  });
});
