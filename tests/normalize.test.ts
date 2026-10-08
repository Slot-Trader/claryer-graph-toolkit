import { describe, expect, it } from 'vitest';
import { ValidationError, normalizeConversation } from '../src/index.js';
import { ada, ben, followUp, kickoff } from './fixtures.js';

describe('normalizeConversation', () => {
  it('resolves ids, timestamps, topics and mentions', () => {
    const c = normalizeConversation(followUp);
    expect(c.id).toBe('c-followup');
    expect(c.startedAt).toBe('2026-02-01T10:00:00.000Z');
    expect(c.topics).toEqual([{ id: 'onboarding-flow', name: 'Onboarding flow' }]);
    expect(c.messages[0]).toMatchObject({ id: 'f1', conversationId: 'c-followup', mentions: ['ben'] });
    // Messages without sentAt are spaced one second apart from the start.
    expect(c.messages[1]!.sentAt).toBe('2026-02-01T10:00:01.000Z');
  });

  it('generates conversation, message and decision ids when omitted', () => {
    const c = normalizeConversation({
      participants: [ada],
      messages: [{ senderId: 'ada', text: 'hi' }],
      decisions: [{ description: 'Do it' }],
    });
    expect(c.id).toMatch(/^conv_/);
    expect(c.messages[0]!.id).toBe(`${c.id}_msg_1`);
    expect(c.decisions[0]).toMatchObject({ id: `${c.id}_dec_1`, source: 'input', assignedTo: [] });
  });

  it('collects topics from messages and decisions without duplicates', () => {
    const c = normalizeConversation({
      ...kickoff,
      messages: [{ senderId: 'ada', text: 'x', topics: ['Onboarding Flow', 'Pricing'] }],
    });
    expect(c.topics.map((t) => t.id)).toEqual(['onboarding-flow', 'pricing']);
  });

  it('does not count a sender mentioning themselves', () => {
    const c = normalizeConversation({ participants: [ada, ben], messages: [{ senderId: 'ada', text: '@ada @Ben ok' }] });
    expect(c.messages[0]!.mentions).toEqual(['ben']);
  });

  it('rejects structurally invalid input with every issue listed', () => {
    try {
      normalizeConversation({ participants: [], messages: [] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).issues).toHaveLength(2);
    }
  });

  it('rejects references to non-participants and duplicate ids', () => {
    const run = () =>
      normalizeConversation({
        participants: [ada, ada],
        messages: [
          { id: 'x', senderId: 'ghost', text: 'hi', mentions: ['nobody'] },
          { id: 'x', senderId: 'ada', text: 'hi' },
        ],
        decisions: [{ description: 'd', madeBy: 'ghost', assignedTo: ['nobody'] }],
      });
    expect(run).toThrow(ValidationError);
    try {
      run();
    } catch (e) {
      const issues = (e as ValidationError).issues.join('\n');
      expect(issues).toContain('duplicate id "ada"');
      expect(issues).toContain('messages.0.senderId: "ghost" is not a participant');
      expect(issues).toContain('messages.0.mentions.0');
      expect(issues).toContain('messages.1.id: duplicate id "x"');
      expect(issues).toContain('decisions.0.madeBy');
      expect(issues).toContain('decisions.0.assignedTo.0');
    }
  });

  it('rejects invalid dates', () => {
    expect(() => normalizeConversation({ ...kickoff, startedAt: 'yesterday' })).toThrow(ValidationError);
  });
});
