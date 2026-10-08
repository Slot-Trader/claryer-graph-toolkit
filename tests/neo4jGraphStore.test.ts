import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';
import { describe, expect, it, vi } from 'vitest';
import { Neo4jGraphStore, SCHEMA_CONSTRAINTS, normalizeConversation } from '../src/index.js';
import { kickoff } from './fixtures.js';

type Row = Record<string, unknown>;
interface Call {
  query: string;
  params: Record<string, unknown>;
  mode: 'read' | 'write';
}

/** Minimal stand-in for neo4j-driver: records every query and answers with canned rows. */
function fakeDriver(respond: (query: string, params: Record<string, unknown>) => Row[] = () => []) {
  const calls: Call[] = [];
  const transactions: string[] = [];
  const session = (mode: 'read' | 'write') => ({
    run: async (query: string, params: Record<string, unknown> = {}) => {
      calls.push({ query, params, mode });
      return { records: respond(query, params).map((r) => ({ toObject: () => r })) };
    },
  });
  const driver = {
    session: vi.fn(() => ({
      executeWrite: async (work: (tx: unknown) => Promise<unknown>) => {
        transactions.push('write');
        return work(session('write'));
      },
      executeRead: async (work: (tx: unknown) => Promise<unknown>) => {
        transactions.push('read');
        return work(session('read'));
      },
      close: vi.fn(async () => {}),
    })),
    close: vi.fn(async () => {}),
  };
  return { driver: driver as unknown as Driver, raw: driver, calls, transactions };
}

const has = (fragment: string) => (q: string) => q.includes(fragment);

describe('Neo4jGraphStore (mocked driver)', () => {
  it('creates a uniqueness constraint per label on init', async () => {
    const { driver, calls } = fakeDriver();
    await new Neo4jGraphStore(driver).init();
    expect(calls.map((c) => c.query)).toEqual(SCHEMA_CONSTRAINTS);
    expect(SCHEMA_CONSTRAINTS).toHaveLength(5);
  });

  it('saves a conversation in one write transaction using parameters only', async () => {
    const { driver, calls, transactions } = fakeDriver();
    const conversation = normalizeConversation(kickoff);
    await new Neo4jGraphStore(driver, 'mydb').saveConversation(conversation);

    expect(transactions).toEqual(['write']);
    expect(calls.every((c) => c.mode === 'write')).toBe(true);
    // No user-provided content may appear inside Cypher text.
    for (const c of calls) {
      expect(c.query).not.toContain('onboarding');
      expect(c.query).not.toContain('Ada Lin');
    }

    const people = calls.find((c) => has('MERGE (person:Person')(c.query))!;
    expect(people.params.people).toEqual([
      { id: 'ada', name: 'Ada Lin', role: 'Designer' },
      { id: 'ben', name: 'Ben Cole', role: 'Engineer' },
    ]);
    const messages = calls.find((c) => has('MERGE (msg:Message')(c.query))!;
    expect(messages.params.messages).toHaveLength(2);
    const decisions = calls.find((c) => has('MERGE (dec:Decision')(c.query))!;
    expect(decisions.params.decisions).toEqual([
      {
        id: 'd-ship-march',
        conversationId: 'c-kickoff',
        description: 'Ship onboarding in March',
        source: 'input',
        madeBy: 'ada',
        assignedTo: ['ben'],
        topicIds: ['onboarding-flow'],
      },
    ]);
    expect(raw(driver).session).toHaveBeenCalledWith({ database: 'mydb', defaultAccessMode: neo4j.session.WRITE });
  });

  it('links person and topic mentions with label-specific queries', async () => {
    const { driver, calls } = fakeDriver();
    const conversation = normalizeConversation({
      ...kickoff,
      messages: [{ id: 'x1', senderId: 'ada', text: '@ben look', topics: ['Pricing'] }],
    });
    await new Neo4jGraphStore(driver).saveConversation(conversation);
    const personLinks = calls.find((c) => has('(target:Person')(c.query))!;
    const topicLinks = calls.find((c) => has('(target:Topic')(c.query))!;
    expect(personLinks.params.rows).toEqual([{ messageId: 'x1', targetId: 'ben' }]);
    expect(topicLinks.params.rows).toEqual([{ messageId: 'x1', targetId: 'pricing' }]);
  });

  it('maps query rows back into a Conversation', async () => {
    const expected = normalizeConversation(kickoff);
    const { driver, transactions } = fakeDriver((q) => {
      if (has('RETURN c {.id')(q)) return [{ conversation: { id: 'c-kickoff', title: 'Kickoff', startedAt: expected.startedAt, source: null } }];
      if (has('RETURN p {.id')(q)) return expected.participants.map((p) => ({ person: { ...p } }));
      if (has('RETURN t {.id')(q)) return expected.topics.map((t) => ({ topic: t }));
      if (has('RETURN m {.id')(q))
        return expected.messages.map((m) => ({
          message: { id: m.id, text: m.text, sentAt: m.sentAt },
          senderId: m.senderId,
          mentions: m.mentions,
          topicIds: m.topicIds,
        }));
      if (has('RETURN d {.id')(q))
        return [
          {
            decision: { id: 'd-ship-march', description: 'Ship onboarding in March', source: 'input' },
            conversationId: 'c-kickoff',
            madeBy: 'ada',
            assignedTo: ['ben'],
            topicIds: ['onboarding-flow'],
          },
        ];
      return [];
    });
    const result = await new Neo4jGraphStore(driver).getConversation('c-kickoff');
    expect(result).toEqual({ ...expected, source: undefined });
    expect(transactions).toEqual(['read']);
  });

  it('returns null when the conversation does not exist', async () => {
    const { driver } = fakeDriver();
    expect(await new Neo4jGraphStore(driver).getConversation('nope')).toBeNull();
    expect(await new Neo4jGraphStore(driver).getContext('nope')).toBeNull();
  });

  it('ranks related conversations and passes LIMIT as a Neo4j integer', async () => {
    const conv = { id: 'c-1', title: 'Focal', startedAt: '2026-01-01T00:00:00.000Z', source: null };
    const { driver, calls } = fakeDriver((q) => {
      if (has('RETURN c {.id')(q)) return [{ conversation: conv }];
      if (has('UNION ALL')(q))
        return [
          { conversation: { id: 'c-a', title: null, startedAt: '2026-01-02' }, personId: 'ada', topicId: null },
          { conversation: { id: 'c-b', title: 'B', startedAt: '2026-01-03' }, personId: 'ada', topicId: null },
          { conversation: { id: 'c-b', title: 'B', startedAt: '2026-01-03' }, personId: null, topicId: 'pricing' },
        ];
      if (has('RETURN d.id AS id')(q)) return [{ id: 'd-1' }];
      return [];
    });
    const ctx = await new Neo4jGraphStore(driver).getContext('c-1', { maxRelatedDecisions: 3 });
    expect(ctx!.relatedConversations.map((c) => c.id)).toEqual(['c-b', 'c-a']);
    expect(ctx!.relatedConversations[0]).toMatchObject({ sharedParticipantIds: ['ada'], sharedTopicIds: ['pricing'] });

    const hydrate = calls.find((c) => has('d.id IN $ids')(c.query))!;
    expect(hydrate.params.ids).toEqual(['d-1']);
    expect(neo4j.isInt(hydrate.params.limit)).toBe(true);
    expect((hydrate.params.limit as { toNumber(): number }).toNumber()).toBe(3);
  });

  it('only closes drivers it created', async () => {
    const { driver } = fakeDriver();
    await new Neo4jGraphStore(driver).close();
    expect(raw(driver).close).not.toHaveBeenCalled();
    await new Neo4jGraphStore(driver, undefined, { ownsDriver: true }).close();
    expect(raw(driver).close).toHaveBeenCalledOnce();
  });
});

function raw(driver: Driver) {
  return driver as unknown as { session: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}
