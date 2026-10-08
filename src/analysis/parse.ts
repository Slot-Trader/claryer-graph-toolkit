import { z } from 'zod';
import { AnalysisParseError } from '../errors.js';
import type { AnalysisResult, Conversation } from '../types/index.js';

const severity = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(['low', 'medium', 'high']));

// Lenient where models commonly vary (null vs missing), strict on structure.
const analysisSchema = z.object({
  summary: z.string(),
  decisions: z
    .array(
      z.object({
        description: z.string(),
        owner: z.string().nullish(),
        interpretations: z
          .array(z.object({ personId: z.string(), understanding: z.string() }))
          .default([]),
      }),
    )
    .default([]),
  risks: z
    .array(
      z.object({
        type: z.string(),
        description: z.string(),
        severity,
        involvedPersonIds: z.array(z.string()).default([]),
        evidenceMessageIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  suggestedClarifications: z.array(z.string()).default([]),
});

/** Extracts the first JSON object from model output, tolerating ```json fences and surrounding prose. */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object found');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

/**
 * Parses and validates LLM output into an AnalysisResult.
 *
 * References the model could not have grounded — person ids that are not participants
 * and message ids that are not in the conversation — are dropped, so downstream code can
 * trust every id it receives.
 *
 * @throws AnalysisParseError with the raw output attached.
 */
export function parseAnalysis(
  raw: string,
  conversation: Conversation,
  provider: AnalysisResult['provider'],
): AnalysisResult {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (cause) {
    throw new AnalysisParseError('LLM output was not valid JSON', raw, { cause });
  }
  const parsed = analysisSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AnalysisParseError(`LLM output did not match the analysis schema: ${issues}`, raw);
  }

  const people = new Set(conversation.participants.map((p) => p.id));
  const messages = new Set(conversation.messages.map((m) => m.id));
  const data = parsed.data;

  return {
    conversationId: conversation.id,
    summary: data.summary,
    decisions: data.decisions.map((d) => ({
      description: d.description,
      owner: d.owner && people.has(d.owner) ? d.owner : undefined,
      interpretations: d.interpretations.filter((i) => people.has(i.personId)),
    })),
    risks: data.risks.map((r) => ({
      type: r.type,
      description: r.description,
      severity: r.severity,
      involvedPersonIds: r.involvedPersonIds.filter((id) => people.has(id)),
      evidenceMessageIds: r.evidenceMessageIds.filter((id) => messages.has(id)),
    })),
    suggestedClarifications: data.suggestedClarifications,
    provider,
  };
}
