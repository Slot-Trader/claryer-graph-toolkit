import type { ContextOptions, Conversation, Decision, GraphContext, Person, Topic } from '../types/index.js';
import { canonicalConversation, canonicalDecision } from './canonical.js';
import type { GraphStore } from './GraphStore.js';
import { resolveContextOptions } from './GraphStore.js';
import type { RelationLink } from './ranking.js';
import { rankRelatedConversations, sortDecisionsByRecency } from './ranking.js';

type StoredConversation = Omit<Conversation, 'participants' | 'topics' | 'decisions'> & {
  participantIds: string[];
  topicIds: string[];
};

/**
 * A dependency-free GraphStore that keeps everything in process memory.
 *
 * Mirrors `Neo4jGraphStore` semantics, so it is useful for unit tests, demos, and
 * prototyping. Data is lost when the process exits — use Neo4j for anything real.
 */
export class InMemoryGraphStore implements GraphStore {
  private readonly people = new Map<string, Person>();
  private readonly topics = new Map<string, Topic>();
  private readonly conversations = new Map<string, StoredConversation>();
  private readonly decisions = new Map<string, Decision>();

  async init(): Promise<void> {}

  async saveConversation(conversation: Conversation): Promise<void> {
    for (const p of conversation.participants) this.people.set(p.id, structuredClone(p));
    for (const t of conversation.topics) {
      if (!this.topics.has(t.id)) this.topics.set(t.id, structuredClone(t));
    }
    const existing = this.conversations.get(conversation.id);
    const messages = new Map((existing?.messages ?? []).map((m) => [m.id, m]));
    for (const m of conversation.messages) messages.set(m.id, structuredClone(m));

    this.conversations.set(conversation.id, {
      id: conversation.id,
      title: conversation.title,
      startedAt: conversation.startedAt,
      source: conversation.source,
      messages: [...messages.values()],
      participantIds: union(existing?.participantIds, conversation.participants.map((p) => p.id)),
      topicIds: union(existing?.topicIds, conversation.topics.map((t) => t.id)),
    });
    await this.saveDecisions(conversation.decisions);
  }

  async saveDecisions(decisions: Decision[]): Promise<void> {
    for (const d of decisions) {
      const conversation = this.conversations.get(d.conversationId);
      if (!conversation) continue; // Neo4j store also skips decisions for unknown conversations.
      this.decisions.set(d.id, structuredClone(d));
      for (const topicId of d.topicIds) {
        if (!this.topics.has(topicId)) this.topics.set(topicId, { id: topicId, name: topicId });
        if (!conversation.topicIds.includes(topicId)) conversation.topicIds.push(topicId);
      }
    }
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const stored = this.conversations.get(conversationId);
    if (!stored) return null;
    const { participantIds, topicIds, ...rest } = stored;
    return structuredClone(
      canonicalConversation({
        ...rest,
        participants: participantIds.map((id) => this.people.get(id)!),
        topics: topicIds.map((id) => this.topics.get(id)!),
        decisions: [...this.decisions.values()].filter((d) => d.conversationId === conversationId),
      }),
    );
  }

  async getContext(conversationId: string, options?: ContextOptions): Promise<GraphContext | null> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return null;
    const opts = resolveContextOptions(options);
    const participantIds = new Set(conversation.participants.map((p) => p.id));
    const topicIds = new Set(conversation.topics.map((t) => t.id));

    const links: RelationLink[] = [];
    for (const other of this.conversations.values()) {
      if (other.id === conversationId) continue;
      const summary = { id: other.id, title: other.title, startedAt: other.startedAt };
      for (const pid of other.participantIds) {
        if (participantIds.has(pid)) links.push({ conversation: summary, personId: pid });
      }
      for (const tid of other.topicIds) {
        if (topicIds.has(tid)) links.push({ conversation: summary, topicId: tid });
      }
    }

    const related = [...this.decisions.values()].filter(
      (d) =>
        d.conversationId !== conversationId &&
        ((d.madeBy !== undefined && participantIds.has(d.madeBy)) ||
          d.assignedTo.some((id) => participantIds.has(id)) ||
          d.topicIds.some((id) => topicIds.has(id))),
    );

    return {
      conversation,
      relatedConversations: rankRelatedConversations(links, opts.maxRelatedConversations),
      relatedDecisions: structuredClone(
        sortDecisionsByRecency(related, (id) => this.conversations.get(id)?.startedAt ?? '')
          .slice(0, opts.maxRelatedDecisions)
          .map(canonicalDecision),
      ),
    };
  }

  async close(): Promise<void> {}
}

function union(a: string[] | undefined, b: string[]): string[] {
  return [...new Set([...(a ?? []), ...b])];
}
