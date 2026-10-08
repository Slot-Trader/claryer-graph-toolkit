/**
 * Core domain types for graph-context-kit.
 *
 * Two layers:
 *  - `*Input` types are what developers pass in (loose: ids/timestamps optional).
 *  - Normalized entity types are what the toolkit stores and returns (strict: every id resolved).
 */

// ─── Input ──────────────────────────────────────────────────────────────────

export interface PersonInput {
  id: string;
  name: string;
  role?: string;
}

export interface MessageInput {
  id?: string;
  senderId: string;
  text: string;
  /** ISO-8601 timestamp. Defaults to conversation start + message index (seconds). */
  sentAt?: string;
  /** Person ids explicitly mentioned. `@name` mentions are also detected automatically. */
  mentions?: string[];
  /** Topic names this message is about. */
  topics?: string[];
}

export interface DecisionInput {
  id?: string;
  description: string;
  /** Person id of who made the decision. */
  madeBy?: string;
  /** Person ids responsible for carrying it out. */
  assignedTo?: string[];
  topics?: string[];
}

export interface ConversationInput {
  id?: string;
  title?: string;
  /** ISO-8601 timestamp. Defaults to now. */
  startedAt?: string;
  /** Where the conversation came from, e.g. "slack", "meeting-transcript". Free-form. */
  source?: string;
  participants: PersonInput[];
  messages: MessageInput[];
  topics?: string[];
  decisions?: DecisionInput[];
}

// ─── Normalized entities ────────────────────────────────────────────────────

export interface Person {
  id: string;
  name: string;
  role?: string;
}

export interface Topic {
  /** Slug derived from the name, e.g. "Launch Date" → "launch-date". */
  id: string;
  name: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  sentAt: string;
  mentions: string[];
  topicIds: string[];
}

export type DecisionSource = 'input' | 'analysis';

export interface Decision {
  id: string;
  conversationId: string;
  description: string;
  madeBy?: string;
  assignedTo: string[];
  topicIds: string[];
  /** Whether the decision was supplied by the developer or extracted by an LLM analysis. */
  source: DecisionSource;
}

export interface Conversation {
  id: string;
  title?: string;
  startedAt: string;
  source?: string;
  participants: Person[];
  messages: Message[];
  topics: Topic[];
  decisions: Decision[];
}

// ─── Graph context ──────────────────────────────────────────────────────────

export interface RelatedConversation {
  id: string;
  title?: string;
  startedAt: string;
  /** Participants shared with the focal conversation. */
  sharedParticipantIds: string[];
  /** Topics shared with the focal conversation. */
  sharedTopicIds: string[];
}

/** Everything the graph knows that is relevant to one conversation. */
export interface GraphContext {
  conversation: Conversation;
  /** Decisions from *other* conversations that involve these participants or topics, newest first. */
  relatedDecisions: Decision[];
  relatedConversations: RelatedConversation[];
}

export interface ContextOptions {
  /** Max related conversations to return. Default 5. */
  maxRelatedConversations?: number;
  /** Max related decisions to return. Default 10. */
  maxRelatedDecisions?: number;
}

// ─── Analysis result ────────────────────────────────────────────────────────

export type Severity = 'low' | 'medium' | 'high';

export interface Interpretation {
  personId: string;
  understanding: string;
}

export interface AnalyzedDecision {
  description: string;
  owner?: string;
  /** How each participant appears to understand the decision. Divergence here is the signal. */
  interpretations: Interpretation[];
}

export interface MiscommunicationRisk {
  /** Short category, e.g. "ambiguous-ownership", "conflicting-deadline". */
  type: string;
  description: string;
  severity: Severity;
  involvedPersonIds: string[];
  /** Message ids that support this finding. */
  evidenceMessageIds: string[];
}

export interface AnalysisResult {
  conversationId: string;
  summary: string;
  decisions: AnalyzedDecision[];
  risks: MiscommunicationRisk[];
  suggestedClarifications: string[];
  /** Provider name and model that produced this result. */
  provider: { name: string; model?: string };
}
