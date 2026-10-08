/**
 * Runs the real Neo4jGraphStore against a live database.
 * Skipped unless RUN_NEO4J_INTEGRATION=1 (use `npm run test:integration`).
 * WARNING: deletes nodes whose id starts with "it-" — use a disposable/dev database.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neo4j from 'neo4j-driver';
import { InMemoryGraphStore, Neo4jGraphStore, normalizeConversation } from '../src/index.js';
import type { ConversationInput } from '../src/index.js';
import { followUp, kickoff, unrelated } from './fixtures.js';

const enabled = process.env.RUN_NEO4J_INTEGRATION === '1';

// Prefix every id so the test only touches its own data.
function prefixed(input: ConversationInput): ConversationInput {
  const p = (id: string) => `it-${id}`;
  return {
    ...input,
    id: p(input.id!),
    participants: input.participants.map((x) => ({ ...x, id: p(x.id) })),
    messages: input.messages.map((m) => ({ ...m, id: m.id && p(m.id), senderId: p(m.senderId), text: m.text.replace(/@(\w+)/g, '@it-$1') })),
    decisions: input.decisions?.map((d) => ({ ...d, id: d.id && p(d.id), madeBy: d.madeBy && p(d.madeBy), assignedTo: d.assignedTo?.map(p) })),
  };
}

describe.skipIf(!enabled)('Neo4jGraphStore (integration)', () => {
  const driver = enabled
    ? neo4j.driver(process.env.NEO4J_URI!, neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!))
    : undefined;
  const store = driver ? new Neo4jGraphStore(driver, process.env.NEO4J_DATABASE || undefined) : undefined;
  const reference = new InMemoryGraphStore();
  const cleanup = () =>
    driver!.executeQuery('MATCH (n) WHERE n.id STARTS WITH "it-" DETACH DELETE n', {}, { database: process.env.NEO4J_DATABASE || undefined });

  beforeAll(async () => {
    await store!.init();
    await cleanup();
    for (const input of [kickoff, unrelated, followUp].map(prefixed)) {
      const c = normalizeConversation(input);
      await store!.saveConversation(c);
      await reference.saveConversation(c);
    }
  });

  afterAll(async () => {
    await cleanup();
    await driver!.close();
  });

  it('round-trips a conversation', async () => {
    expect(await store!.getConversation('it-c-kickoff')).toEqual(await reference.getConversation('it-c-kickoff'));
  });

  it('returns the same context as the in-memory reference implementation', async () => {
    expect(await store!.getContext('it-c-followup')).toEqual(await reference.getContext('it-c-followup'));
    expect(await store!.getContext('it-c-kickoff')).toEqual(await reference.getContext('it-c-kickoff'));
  });

  it('is idempotent when the same conversation is saved twice', async () => {
    const c = normalizeConversation(prefixed(kickoff));
    await store!.saveConversation(c);
    expect(await store!.getConversation('it-c-kickoff')).toEqual(await reference.getConversation('it-c-kickoff'));
  });

  it('saves extra decisions (e.g. from analysis) and links new topics, matching the reference', async () => {
    const decision = {
      id: 'it-d-analysis',
      conversationId: 'it-c-followup',
      description: 'Ship by end of February',
      madeBy: 'it-ada',
      assignedTo: ['it-ben'],
      topicIds: ['it-deadline'],
      source: 'analysis' as const,
    };
    await store!.saveDecisions([decision]);
    await reference.saveDecisions([decision]);
    expect(await store!.getConversation('it-c-followup')).toEqual(await reference.getConversation('it-c-followup'));
    expect(await store!.getContext('it-c-kickoff')).toEqual(await reference.getContext('it-c-kickoff'));
  });
});
