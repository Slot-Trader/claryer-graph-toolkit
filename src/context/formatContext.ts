import type { Conversation, Decision, GraphContext, Person } from '../types/index.js';
import { truncate } from '../utils/index.js';

export interface FormatOptions {
  /**
   * Approximate character budget for the whole block. Transcript is kept in full where possible;
   * related context is trimmed first, then older messages. Default 24 000 (~6k tokens).
   */
  maxChars?: number;
}

/**
 * Renders a GraphContext as plain text for an LLM prompt.
 *
 * Message ids are included so the model can cite evidence, and people are shown as
 * `Name (id)` so results can refer back to graph ids.
 */
export function formatContext(context: GraphContext, options: FormatOptions = {}): string {
  const maxChars = options.maxChars ?? 24_000;
  const { conversation } = context;
  const people = new Map(conversation.participants.map((p) => [p.id, p]));
  const who = (id: string | undefined) => (id ? label(people.get(id), id) : 'unknown');

  const header = formatHeader(conversation);
  const decisions = conversation.decisions.length
    ? section('Decisions recorded in this conversation', conversation.decisions.map((d) => formatDecision(d, who)))
    : '';

  const related = [
    context.relatedDecisions.length
      ? section(
          'Related decisions from other conversations',
          context.relatedDecisions.map((d) => `${formatDecision(d, who)} [from ${d.conversationId}]`),
        )
      : '',
    context.relatedConversations.length
      ? section(
          'Related conversations',
          context.relatedConversations.map((c) => {
            const reasons = [
              c.sharedParticipantIds.length ? `shared people: ${c.sharedParticipantIds.map(who).join(', ')}` : '',
              c.sharedTopicIds.length ? `shared topics: ${c.sharedTopicIds.join(', ')}` : '',
            ].filter(Boolean);
            return `${c.id}${c.title ? ` "${c.title}"` : ''} (${c.startedAt}) — ${reasons.join('; ')}`;
          }),
        )
      : '',
  ].filter(Boolean);

  const transcriptLines = conversation.messages.map(
    (m) => `[${m.id}] ${who(m.senderId)}: ${m.text.replace(/\s+/g, ' ').trim()}`,
  );

  const fixed = [header, decisions].filter(Boolean).join('\n\n');
  let budget = maxChars - fixed.length - 64;

  // Keep as much of the transcript as fits (newest messages win if it must be cut).
  const kept: string[] = [];
  for (let i = transcriptLines.length - 1; i >= 0; i--) {
    const line = transcriptLines[i]!;
    if (line.length + 1 > budget) {
      // Always keep at least the latest message, truncated if necessary.
      if (kept.length === 0) kept.unshift(truncate(line, Math.max(budget, 200)));
      budget = 0;
      break;
    }
    kept.unshift(line);
    budget -= line.length + 1;
  }
  const omitted = transcriptLines.length - kept.length;
  const transcript = section(
    'Transcript',
    omitted > 0 ? [`(${omitted} earlier message(s) omitted for length)`, ...kept] : kept,
    false,
  );

  // Related context only uses what is left.
  const relatedBlock = truncate(related.join('\n\n'), Math.max(0, budget));

  return [fixed, transcript, relatedBlock].filter(Boolean).join('\n\n');
}

function formatHeader(c: Conversation): string {
  return [
    `Conversation: ${c.id}${c.title ? ` "${c.title}"` : ''}`,
    `Started: ${c.startedAt}${c.source ? ` (source: ${c.source})` : ''}`,
    `Participants: ${c.participants.map((p) => `${label(p, p.id)}${p.role ? `, ${p.role}` : ''}`).join('; ')}`,
    c.topics.length ? `Topics: ${c.topics.map((t) => t.name).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatDecision(d: Decision, who: (id: string | undefined) => string): string {
  const parts = [`${d.id}: ${d.description}`];
  if (d.madeBy) parts.push(`made by ${who(d.madeBy)}`);
  if (d.assignedTo.length) parts.push(`assigned to ${d.assignedTo.map(who).join(', ')}`);
  return parts.join(' — ');
}

function section(title: string, lines: string[], bullets = true): string {
  return `## ${title}\n${lines.map((l) => (bullets ? `- ${l}` : l)).join('\n')}`;
}

function label(person: Person | undefined, id: string): string {
  return person ? `${person.name} (${id})` : id;
}
