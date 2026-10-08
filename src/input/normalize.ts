import { z } from 'zod';
import { ValidationError } from '../errors.js';
import type { Conversation, ConversationInput, Decision, Message, Topic } from '../types/index.js';
import { detectMentions, generateId, slugify, unique } from '../utils/index.js';

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO-8601 date');

const personSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().optional(),
});

const messageSchema = z.object({
  id: z.string().min(1).optional(),
  senderId: z.string().min(1),
  text: z.string().min(1),
  sentAt: isoDate.optional(),
  mentions: z.array(z.string().min(1)).optional(),
  topics: z.array(z.string().min(1)).optional(),
});

const decisionSchema = z.object({
  id: z.string().min(1).optional(),
  description: z.string().min(1),
  madeBy: z.string().min(1).optional(),
  assignedTo: z.array(z.string().min(1)).optional(),
  topics: z.array(z.string().min(1)).optional(),
});

export const conversationInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().optional(),
  startedAt: isoDate.optional(),
  source: z.string().optional(),
  participants: z.array(personSchema).min(1, 'at least one participant is required'),
  messages: z.array(messageSchema).min(1, 'at least one message is required'),
  topics: z.array(z.string().min(1)).optional(),
  decisions: z.array(decisionSchema).optional(),
});

function toTopic(name: string): Topic {
  return { id: slugify(name), name: name.trim() };
}

/**
 * Validates developer input and resolves it into a fully-specified `Conversation`:
 * ids are generated where missing, timestamps defaulted, topics de-duplicated,
 * `@mentions` detected, and every person reference checked against the participants.
 *
 * @throws ValidationError listing every problem found.
 */
export function normalizeConversation(input: ConversationInput): Conversation {
  const parsed = conversationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid conversation input',
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const data = parsed.data;

  const issues: string[] = [];
  const participantIds = new Set<string>();
  for (const p of data.participants) {
    if (participantIds.has(p.id)) issues.push(`participants: duplicate id "${p.id}"`);
    participantIds.add(p.id);
  }
  const checkPerson = (id: string, path: string) => {
    if (!participantIds.has(id)) issues.push(`${path}: "${id}" is not a participant`);
  };

  const conversationId = data.id ?? generateId('conv');
  const startedAt = new Date(data.startedAt ?? Date.now()).toISOString();
  const startMs = Date.parse(startedAt);

  const topicsById = new Map<string, Topic>();
  const addTopics = (names: string[] | undefined): string[] => {
    const ids: string[] = [];
    for (const name of names ?? []) {
      const topic = toTopic(name);
      if (!topic.id) continue;
      if (!topicsById.has(topic.id)) topicsById.set(topic.id, topic);
      ids.push(topic.id);
    }
    return unique(ids);
  };
  addTopics(data.topics);

  const messageIds = new Set<string>();
  const messages: Message[] = data.messages.map((m, index) => {
    checkPerson(m.senderId, `messages.${index}.senderId`);
    m.mentions?.forEach((id, j) => checkPerson(id, `messages.${index}.mentions.${j}`));
    const id = m.id ?? `${conversationId}_msg_${index + 1}`;
    if (messageIds.has(id)) issues.push(`messages.${index}.id: duplicate id "${id}"`);
    messageIds.add(id);
    return {
      id,
      conversationId,
      senderId: m.senderId,
      text: m.text,
      sentAt: m.sentAt ? new Date(m.sentAt).toISOString() : new Date(startMs + index * 1000).toISOString(),
      mentions: unique([...(m.mentions ?? []), ...detectMentions(m.text, data.participants)]).filter(
        (pid) => pid !== m.senderId,
      ),
      topicIds: addTopics(m.topics),
    };
  });

  const decisions: Decision[] = (data.decisions ?? []).map((d, index) => {
    if (d.madeBy) checkPerson(d.madeBy, `decisions.${index}.madeBy`);
    d.assignedTo?.forEach((id, j) => checkPerson(id, `decisions.${index}.assignedTo.${j}`));
    return {
      id: d.id ?? `${conversationId}_dec_${index + 1}`,
      conversationId,
      description: d.description,
      madeBy: d.madeBy,
      assignedTo: unique(d.assignedTo ?? []),
      topicIds: addTopics(d.topics),
      source: 'input',
    };
  });

  if (issues.length > 0) throw new ValidationError('Invalid conversation input', issues);

  return {
    id: conversationId,
    title: data.title,
    startedAt,
    source: data.source,
    participants: data.participants.map((p) => ({ id: p.id, name: p.name, role: p.role })),
    messages,
    topics: [...topicsById.values()],
    decisions,
  };
}
