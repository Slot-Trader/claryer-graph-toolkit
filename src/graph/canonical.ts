import type { Conversation, Decision, Message } from '../types/index.js';

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const sorted = (ids: string[]) => [...ids].sort();

/**
 * Puts a conversation read from a store into canonical order so every GraphStore returns
 * identical output: participants, topics and decisions by id; messages by time (stable);
 * id lists (mentions, assignees, topic ids) sorted.
 */
export function canonicalConversation(c: Conversation): Conversation {
  return {
    ...c,
    participants: [...c.participants].sort(byId),
    topics: [...c.topics].sort(byId),
    messages: [...c.messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt)).map(canonicalMessage),
    decisions: [...c.decisions].sort(byId).map(canonicalDecision),
  };
}

export function canonicalMessage(m: Message): Message {
  return { ...m, mentions: sorted(m.mentions), topicIds: sorted(m.topicIds) };
}

export function canonicalDecision(d: Decision): Decision {
  return { ...d, assignedTo: sorted(d.assignedTo), topicIds: sorted(d.topicIds) };
}
