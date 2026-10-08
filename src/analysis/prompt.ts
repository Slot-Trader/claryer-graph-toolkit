import type { LLMMessage } from '../llm/types.js';

export const ANALYSIS_SYSTEM_PROMPT = `You analyze workplace conversations to surface potential miscommunication.

You receive a transcript plus context retrieved from a knowledge graph (related decisions and conversations).
Identify decisions and responsibilities, how each participant appears to understand them, and any risk that
participants left with different interpretations (ambiguous ownership, conflicting deadlines, unstated
assumptions, contradictions with earlier decisions, unanswered questions, etc.).

Rules:
- Base every finding on the transcript or the provided context. Do not invent facts.
- Refer to people by their id (shown in parentheses) and cite message ids (shown in [brackets]) as evidence.
- If there is no meaningful risk, return an empty "risks" array.
- Respond with a single JSON object and nothing else, matching this shape:

{
  "summary": string,
  "decisions": [
    { "description": string, "owner": string | null,
      "interpretations": [ { "personId": string, "understanding": string } ] }
  ],
  "risks": [
    { "type": string, "description": string, "severity": "low" | "medium" | "high",
      "involvedPersonIds": string[], "evidenceMessageIds": string[] }
  ],
  "suggestedClarifications": string[]
}`;

/** Builds the chat messages sent to the LLM for an analysis. */
export function buildAnalysisMessages(contextText: string, instructions?: string): LLMMessage[] {
  const user = [
    contextText,
    instructions ? `## Additional instructions\n${instructions}` : '',
    'Return the JSON analysis now.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}
