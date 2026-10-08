import type { Decision, RelatedConversation } from '../types/index.js';

/** One reason another conversation is related to the focal one. */
export interface RelationLink {
  conversation: { id: string; title?: string; startedAt: string };
  personId?: string;
  topicId?: string;
}

/**
 * Aggregates per-person / per-topic links into `RelatedConversation`s, ranked by
 * number of shared participants + topics (desc), then recency (desc), then id.
 * Shared by every GraphStore so ranking is identical across backends.
 */
export function rankRelatedConversations(links: RelationLink[], limit: number): RelatedConversation[] {
  const byId = new Map<string, RelatedConversation>();
  for (const link of links) {
    const existing = byId.get(link.conversation.id) ?? {
      id: link.conversation.id,
      title: link.conversation.title ?? undefined,
      startedAt: link.conversation.startedAt,
      sharedParticipantIds: [],
      sharedTopicIds: [],
    };
    if (link.personId && !existing.sharedParticipantIds.includes(link.personId)) {
      existing.sharedParticipantIds.push(link.personId);
    }
    if (link.topicId && !existing.sharedTopicIds.includes(link.topicId)) {
      existing.sharedTopicIds.push(link.topicId);
    }
    byId.set(existing.id, existing);
  }
  const score = (c: RelatedConversation) => c.sharedParticipantIds.length + c.sharedTopicIds.length;
  return [...byId.values()]
    .map((c) => ({ ...c, sharedParticipantIds: c.sharedParticipantIds.sort(), sharedTopicIds: c.sharedTopicIds.sort() }))
    .sort((a, b) => score(b) - score(a) || b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Sorts decisions newest-first by the start time of the conversation they were made in, then by id. */
export function sortDecisionsByRecency(
  decisions: Decision[],
  conversationStartedAt: (conversationId: string) => string,
): Decision[] {
  return [...decisions].sort(
    (a, b) =>
      conversationStartedAt(b.conversationId).localeCompare(conversationStartedAt(a.conversationId)) ||
      a.id.localeCompare(b.id),
  );
}
