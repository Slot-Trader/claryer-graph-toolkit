import neo4j from 'neo4j-driver';
import type { Driver, ManagedTransaction } from 'neo4j-driver';
import type { ContextOptions, Conversation, Decision, GraphContext, Message, Person, Topic } from '../types/index.js';
import { canonicalConversation, canonicalDecision } from './canonical.js';
import type { GraphStore } from './GraphStore.js';
import { resolveContextOptions } from './GraphStore.js';
import type { RelationLink } from './ranking.js';
import { rankRelatedConversations } from './ranking.js';

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  /** Defaults to the server's default database. */
  database?: string;
}

/**
 * Graph schema (all nodes keyed by a unique `id` property):
 *
 *   (:Person)-[:PARTICIPATED_IN]->(:Conversation)
 *   (:Person)-[:SENT]->(:Message)-[:PART_OF]->(:Conversation)
 *   (:Message)-[:MENTIONS]->(:Person|:Topic)
 *   (:Person)-[:MADE_DECISION]->(:Decision)-[:DECIDED_IN]->(:Conversation)
 *   (:Decision)-[:ASSIGNED_TO]->(:Person)
 *   (:Conversation|:Decision)-[:RELATED_TO]->(:Topic)
 */
export const SCHEMA_CONSTRAINTS = ['Person', 'Conversation', 'Message', 'Decision', 'Topic'].map(
  (label) =>
    `CREATE CONSTRAINT ${label.toLowerCase()}_id IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
);

const Q = {
  upsertConversation: `
    MERGE (c:Conversation {id: $id})
    SET c.title = $title, c.startedAt = $startedAt, c.source = $source`,
  upsertParticipants: `
    MATCH (c:Conversation {id: $conversationId})
    UNWIND $people AS p
    MERGE (person:Person {id: p.id})
    SET person.name = p.name, person.role = p.role
    MERGE (person)-[:PARTICIPATED_IN]->(c)`,
  upsertTopics: `
    MATCH (c:Conversation {id: $conversationId})
    UNWIND $topics AS t
    MERGE (topic:Topic {id: t.id})
    ON CREATE SET topic.name = t.name
    MERGE (c)-[:RELATED_TO]->(topic)`,
  upsertMessages: `
    MATCH (c:Conversation {id: $conversationId})
    UNWIND $messages AS m
    MERGE (msg:Message {id: m.id})
    SET msg.text = m.text, msg.sentAt = m.sentAt, msg.seq = m.seq
    MERGE (msg)-[:PART_OF]->(c)
    WITH msg, m
    MATCH (sender:Person {id: m.senderId})
    MERGE (sender)-[:SENT]->(msg)`,
  linkPersonMentions: `
    UNWIND $rows AS row
    MATCH (msg:Message {id: row.messageId}), (target:Person {id: row.targetId})
    MERGE (msg)-[:MENTIONS]->(target)`,
  linkTopicMentions: `
    UNWIND $rows AS row
    MATCH (msg:Message {id: row.messageId}), (target:Topic {id: row.targetId})
    MERGE (msg)-[:MENTIONS]->(target)`,
  upsertDecisions: `
    UNWIND $decisions AS d
    MATCH (c:Conversation {id: d.conversationId})
    MERGE (dec:Decision {id: d.id})
    SET dec.description = d.description, dec.source = d.source
    MERGE (dec)-[:DECIDED_IN]->(c)
    WITH dec, d, c
    OPTIONAL MATCH (maker:Person {id: d.madeBy})
    FOREACH (_ IN CASE WHEN maker IS NULL THEN [] ELSE [1] END | MERGE (maker)-[:MADE_DECISION]->(dec))
    WITH dec, d, c
    UNWIND (CASE WHEN size(d.assignedTo) = 0 THEN [null] ELSE d.assignedTo END) AS assigneeId
    OPTIONAL MATCH (assignee:Person {id: assigneeId})
    FOREACH (_ IN CASE WHEN assignee IS NULL THEN [] ELSE [1] END | MERGE (dec)-[:ASSIGNED_TO]->(assignee))
    WITH DISTINCT dec, d, c
    UNWIND d.topicIds AS topicId
    MERGE (topic:Topic {id: topicId})
    ON CREATE SET topic.name = topicId
    MERGE (dec)-[:RELATED_TO]->(topic)
    MERGE (c)-[:RELATED_TO]->(topic)`,
  getConversation: `
    MATCH (c:Conversation {id: $id})
    RETURN c {.id, .title, .startedAt, .source} AS conversation`,
  getParticipants: `
    MATCH (p:Person)-[:PARTICIPATED_IN]->(:Conversation {id: $id})
    RETURN p {.id, .name, .role} AS person
    ORDER BY p.id`,
  getTopics: `
    MATCH (:Conversation {id: $id})-[:RELATED_TO]->(t:Topic)
    RETURN t {.id, .name} AS topic
    ORDER BY t.id`,
  getMessages: `
    MATCH (m:Message)-[:PART_OF]->(:Conversation {id: $id})
    OPTIONAL MATCH (sender:Person)-[:SENT]->(m)
    OPTIONAL MATCH (m)-[:MENTIONS]->(mp:Person)
    OPTIONAL MATCH (m)-[:MENTIONS]->(mt:Topic)
    WITH m, sender, collect(DISTINCT mp.id) AS mentions, collect(DISTINCT mt.id) AS topicIds
    ORDER BY m.sentAt, m.seq
    RETURN m {.id, .text, .sentAt} AS message, sender.id AS senderId, mentions, topicIds`,
  relatedConversationLinks: `
    MATCH (c:Conversation {id: $id})<-[:PARTICIPATED_IN]-(p:Person)-[:PARTICIPATED_IN]->(other:Conversation)
    WHERE other <> c
    RETURN other {.id, .title, .startedAt} AS conversation, p.id AS personId, null AS topicId
    UNION ALL
    MATCH (c:Conversation {id: $id})-[:RELATED_TO]->(t:Topic)<-[:RELATED_TO]-(other:Conversation)
    WHERE other <> c
    RETURN other {.id, .title, .startedAt} AS conversation, null AS personId, t.id AS topicId`,
  relatedDecisionIds: `
    MATCH (c:Conversation {id: $id})<-[:PARTICIPATED_IN]-(:Person)-[:MADE_DECISION|ASSIGNED_TO]-(d:Decision)
    WHERE NOT (d)-[:DECIDED_IN]->(c)
    RETURN d.id AS id
    UNION
    MATCH (c:Conversation {id: $id})-[:RELATED_TO]->(:Topic)<-[:RELATED_TO]-(d:Decision)
    WHERE NOT (d)-[:DECIDED_IN]->(c)
    RETURN d.id AS id`,
};

/** Hydrates decisions matching `whereClause` (which may reference `d` and `dc`). */
const decisionsQuery = (whereClause: string, limited: boolean) => `
  MATCH (d:Decision)-[:DECIDED_IN]->(dc:Conversation)
  WHERE ${whereClause}
  OPTIONAL MATCH (maker:Person)-[:MADE_DECISION]->(d)
  OPTIONAL MATCH (d)-[:ASSIGNED_TO]->(a:Person)
  OPTIONAL MATCH (d)-[:RELATED_TO]->(t:Topic)
  WITH d, dc, maker, collect(DISTINCT a.id) AS assignedTo, collect(DISTINCT t.id) AS topicIds
  ORDER BY dc.startedAt DESC, d.id
  ${limited ? 'LIMIT $limit' : ''}
  RETURN d {.id, .description, .source} AS decision, dc.id AS conversationId,
         maker.id AS madeBy, assignedTo, topicIds`;

type Row = Record<string, unknown>;

/**
 * GraphStore backed by Neo4j 5.x.
 *
 * All queries are parameterized; no input is ever interpolated into Cypher.
 */
export class Neo4jGraphStore implements GraphStore {
  private readonly ownsDriver: boolean;

  /**
   * @param driver An existing neo4j-driver `Driver`. Use `Neo4jGraphStore.connect(config)`
   *               to have the store create (and close) its own driver.
   */
  constructor(
    private readonly driver: Driver,
    private readonly database?: string,
    options: { ownsDriver?: boolean } = {},
  ) {
    this.ownsDriver = options.ownsDriver ?? false;
  }

  static connect(config: Neo4jConfig): Neo4jGraphStore {
    const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
    return new Neo4jGraphStore(driver, config.database || undefined, { ownsDriver: true });
  }

  async init(): Promise<void> {
    // Schema operations must each run in their own transaction.
    for (const statement of SCHEMA_CONSTRAINTS) {
      await this.write((tx) => tx.run(statement));
    }
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const conversationId = conversation.id;
    await this.write(async (tx) => {
      await tx.run(Q.upsertConversation, {
        id: conversationId,
        title: conversation.title ?? null,
        startedAt: conversation.startedAt,
        source: conversation.source ?? null,
      });
      await tx.run(Q.upsertParticipants, {
        conversationId,
        people: conversation.participants.map((p) => ({ id: p.id, name: p.name, role: p.role ?? null })),
      });
      await tx.run(Q.upsertTopics, { conversationId, topics: conversation.topics });
      await tx.run(Q.upsertMessages, {
        conversationId,
        messages: conversation.messages.map((m, seq) => ({
          id: m.id,
          text: m.text,
          sentAt: m.sentAt,
          senderId: m.senderId,
          seq,
        })),
      });
      const personRows = conversation.messages.flatMap((m) =>
        m.mentions.map((targetId) => ({ messageId: m.id, targetId })),
      );
      const topicRows = conversation.messages.flatMap((m) =>
        m.topicIds.map((targetId) => ({ messageId: m.id, targetId })),
      );
      if (personRows.length > 0) await tx.run(Q.linkPersonMentions, { rows: personRows });
      if (topicRows.length > 0) await tx.run(Q.linkTopicMentions, { rows: topicRows });
      await runUpsertDecisions(tx, conversation.decisions);
    });
  }

  async saveDecisions(decisions: Decision[]): Promise<void> {
    if (decisions.length === 0) return;
    await this.write((tx) => runUpsertDecisions(tx, decisions));
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    return this.read(async (tx) => {
      const params = { id: conversationId };
      const [head] = rows(await tx.run(Q.getConversation, params));
      if (!head) return null;
      const c = head.conversation as Row;

      const participants = rows(await tx.run(Q.getParticipants, params)).map((r) =>
        toPerson(r.person as Row),
      );
      const topics = rows(await tx.run(Q.getTopics, params)).map((r) => toTopic(r.topic as Row));
      const messages = rows(await tx.run(Q.getMessages, params)).map((r) => toMessage(r, conversationId));
      const decisions = rows(await tx.run(decisionsQuery('dc.id = $id', false), params)).map(toDecision);

      return canonicalConversation({
        id: c.id as string,
        title: optional(c.title),
        startedAt: c.startedAt as string,
        source: optional(c.source),
        participants,
        topics,
        messages,
        decisions,
      });
    });
  }

  async getContext(conversationId: string, options?: ContextOptions): Promise<GraphContext | null> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return null;
    const opts = resolveContextOptions(options);

    return this.read(async (tx) => {
      const params = { id: conversationId };
      const links: RelationLink[] = rows(await tx.run(Q.relatedConversationLinks, params)).map((r) => {
        const c = r.conversation as Row;
        return {
          conversation: { id: c.id as string, title: optional(c.title), startedAt: c.startedAt as string },
          personId: optional(r.personId),
          topicId: optional(r.topicId),
        };
      });

      const ids = rows(await tx.run(Q.relatedDecisionIds, params)).map((r) => r.id as string);
      const relatedDecisions =
        ids.length === 0
          ? []
          : rows(
              await tx.run(decisionsQuery('d.id IN $ids', true), {
                ids,
                limit: neo4j.int(opts.maxRelatedDecisions),
              }),
            ).map((r) => canonicalDecision(toDecision(r)));

      return {
        conversation,
        relatedConversations: rankRelatedConversations(links, opts.maxRelatedConversations),
        relatedDecisions,
      };
    });
  }

  async close(): Promise<void> {
    if (this.ownsDriver) await this.driver.close();
  }

  private async write<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.driver.session({ database: this.database, defaultAccessMode: neo4j.session.WRITE });
    try {
      return await session.executeWrite(work);
    } finally {
      await session.close();
    }
  }

  private async read<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.driver.session({ database: this.database, defaultAccessMode: neo4j.session.READ });
    try {
      return await session.executeRead(work);
    } finally {
      await session.close();
    }
  }
}

async function runUpsertDecisions(tx: ManagedTransaction, decisions: Decision[]): Promise<void> {
  if (decisions.length === 0) return;
  await tx.run(Q.upsertDecisions, {
    decisions: decisions.map((d) => ({
      id: d.id,
      conversationId: d.conversationId,
      description: d.description,
      source: d.source,
      madeBy: d.madeBy ?? null,
      assignedTo: d.assignedTo,
      topicIds: d.topicIds,
    })),
  });
}

function rows(result: { records: { toObject(): Row }[] }): Row[] {
  return result.records.map((r) => r.toObject());
}

function optional(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toPerson(p: Row): Person {
  return { id: p.id as string, name: p.name as string, role: optional(p.role) };
}

function toTopic(t: Row): Topic {
  return { id: t.id as string, name: (t.name as string | null) ?? (t.id as string) };
}

function toMessage(r: Row, conversationId: string): Message {
  const m = r.message as Row;
  return {
    id: m.id as string,
    conversationId,
    senderId: r.senderId as string,
    text: m.text as string,
    sentAt: m.sentAt as string,
    mentions: (r.mentions as string[]) ?? [],
    topicIds: (r.topicIds as string[]) ?? [],
  };
}

function toDecision(r: Row): Decision {
  const d = r.decision as Row;
  return {
    id: d.id as string,
    conversationId: r.conversationId as string,
    description: d.description as string,
    madeBy: optional(r.madeBy),
    assignedTo: (r.assignedTo as string[]) ?? [],
    topicIds: (r.topicIds as string[]) ?? [],
    source: (d.source as Decision['source']) ?? 'input',
  };
}
