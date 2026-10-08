import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryGraphStore, formatContext, normalizeConversation } from '../src/index.js';
import type { GraphContext } from '../src/index.js';
import { followUp, kickoff } from './fixtures.js';

describe('formatContext', () => {
  let ctx: GraphContext;

  beforeEach(async () => {
    const store = new InMemoryGraphStore();
    await store.saveConversation(normalizeConversation(kickoff));
    await store.saveConversation(normalizeConversation(followUp));
    ctx = (await store.getContext('c-followup'))!;
  });

  it('includes participants, the transcript with message ids, and related graph context', () => {
    const text = formatContext(ctx);
    expect(text).toContain('Participants: Ada Lin (ada), Designer; Ben Cole (ben), Engineer');
    expect(text).toContain('[f1] Ada Lin (ada): @ben can we get onboarding out by end of February?');
    expect(text).toContain('## Related decisions from other conversations');
    expect(text).toContain('d-ship-march: Ship onboarding in March — made by Ada Lin (ada) — assigned to Ben Cole (ben) [from c-kickoff]');
    expect(text).toContain('c-kickoff "Kickoff"');
  });

  it('omits empty sections', () => {
    const text = formatContext({ ...ctx, relatedDecisions: [], relatedConversations: [] });
    expect(text).not.toContain('Related');
  });

  it('keeps the newest messages and reports omissions when over budget', () => {
    const many = {
      ...ctx,
      conversation: {
        ...ctx.conversation,
        messages: Array.from({ length: 200 }, (_, i) => ({
          ...ctx.conversation.messages[0]!,
          id: `msg-${i}`,
          text: `message number ${i} ${'x'.repeat(50)}`,
        })),
      },
    };
    const text = formatContext(many, { maxChars: 2_000 });
    expect(text.length).toBeLessThanOrEqual(2_000);
    expect(text).toContain('[msg-199]');
    expect(text).not.toContain('[msg-0]');
    expect(text).toMatch(/\(\d+ earlier message\(s\) omitted for length\)/);
  });
});
