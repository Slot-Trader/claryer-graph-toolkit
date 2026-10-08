import type { ContextOptions, Conversation, Decision, GraphContext } from '../types/index.js';

/**
 * Storage abstraction for the conversation graph.
 *
 * `Neo4jGraphStore` is the production implementation; `InMemoryGraphStore` mirrors its
 * semantics for tests, demos, and prototyping without a database. Implement this interface
 * to back the toolkit with a different graph database.
 */
export interface GraphStore {
  /** Creates constraints/indexes if needed. Safe to call repeatedly. */
  init(): Promise<void>;

  /**
   * Upserts a conversation and all of its people, messages, topics, decisions and relationships.
   * Saving the same conversation id again updates existing nodes (idempotent by id).
   */
  saveConversation(conversation: Conversation): Promise<void>;

  /** Upserts decisions (e.g. ones extracted by an analysis) and links them into the graph. */
  saveDecisions(decisions: Decision[]): Promise<void>;

  getConversation(conversationId: string): Promise<Conversation | null>;

  /**
   * Returns the conversation plus related graph context: other conversations sharing
   * participants or topics, and decisions from those conversations that involve the
   * same people or topics. Returns `null` if the conversation does not exist.
   */
  getContext(conversationId: string, options?: ContextOptions): Promise<GraphContext | null>;

  close(): Promise<void>;
}

export const DEFAULT_CONTEXT_OPTIONS: Required<ContextOptions> = {
  maxRelatedConversations: 5,
  maxRelatedDecisions: 10,
};

export function resolveContextOptions(options?: ContextOptions): Required<ContextOptions> {
  return { ...DEFAULT_CONTEXT_OPTIONS, ...stripUndefined(options ?? {}) };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
