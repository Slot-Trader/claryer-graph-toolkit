import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryGraphStore, normalizeConversation } from '../src/index.js';
import { followUp, kickoff, unrelated } from './fixtures.js';

describe('InMemoryGraphStore', () => {
  let store: InMemoryGraphStore;

  beforeEach(async () => {
    store = new InMemoryGraphStore();
    await store.init();
    for (const input of [kickoff, unrelated, followUp]) {
      await store.saveConversation(normalizeConversation(input));
    }
  });

  it('round-trips a conversation', async () => {
    const original = normalizeConversation(kickoff);
    expect(await store.getConversation('c-kickoff')).toEqual(original);
  });

  it('returns null for unknown conversations', async () => {
    expect(await store.getConversation('missing')).toBeNull();
    expect(await store.getContext('missing')).toBeNull();
  });

  it('upserts idempotently by id', async () => {
    await store.saveConversation(normalizeConversation(kickoff));
    const c = await store.getConversation('c-kickoff');
    expect(c!.messages).toHaveLength(2);
    expect(c!.decisions).toHaveLength(1);
  });

  it('retrieves related conversations by shared people and topics, excluding unrelated ones', async () => {
    const ctx = await store.getContext('c-followup');
    expect(ctx!.relatedConversations).toEqual([
      {
        id: 'c-kickoff',
        title: 'Kickoff',
        startedAt: '2026-01-05T10:00:00.000Z',
        sharedParticipantIds: ['ada', 'ben'],
        sharedTopicIds: ['onboarding-flow'],
      },
    ]);
  });

  it('retrieves decisions from other conversations involving the same people or topics', async () => {
    const ctx = await store.getContext('c-followup');
    expect(ctx!.relatedDecisions.map((d) => d.id)).toEqual(['d-ship-march']);
  });

  it('does not include the focal conversation’s own decisions as related', async () => {
    const ctx = await store.getContext('c-kickoff');
    expect(ctx!.relatedDecisions).toEqual([]);
  });

  it('respects context limits', async () => {
    const ctx = await store.getContext('c-followup', { maxRelatedConversations: 0, maxRelatedDecisions: 0 });
    expect(ctx!.relatedConversations).toEqual([]);
    expect(ctx!.relatedDecisions).toEqual([]);
  });

  it('saves additional decisions and links new topics to the conversation', async () => {
    await store.saveDecisions([
      { id: 'd-new', conversationId: 'c-followup', description: 'Ship in Feb', assignedTo: ['ben'], topicIds: ['deadline'], source: 'analysis' },
      { id: 'd-orphan', conversationId: 'missing', description: 'ignored', assignedTo: [], topicIds: [], source: 'analysis' },
    ]);
    const c = await store.getConversation('c-followup');
    expect(c!.decisions.map((d) => d.id)).toEqual(['d-new']);
    expect(c!.topics.map((t) => t.id)).toContain('deadline');
  });

  it('returns copies so callers cannot mutate stored state', async () => {
    const c = await store.getConversation('c-kickoff');
    c!.messages[0]!.text = 'tampered';
    expect((await store.getConversation('c-kickoff'))!.messages[0]!.text).not.toBe('tampered');
  });
});
