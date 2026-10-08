export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  /** Ask the provider for a JSON object response, if it supports that. */
  responseFormat?: 'text' | 'json';
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMResponse {
  content: string;
  model?: string;
  usage?: LLMUsage;
}

/**
 * The only contract the toolkit needs from a model provider.
 * Implement `complete` to plug in any model — see README "LLM provider architecture".
 */
export interface LLMProvider {
  /** Human-readable provider name, recorded on every AnalysisResult. */
  readonly name: string;
  /** Model identifier, if known. */
  readonly model?: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}
