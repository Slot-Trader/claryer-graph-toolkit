import { ProviderError } from '../errors.js';
import type { LLMProvider, LLMRequest, LLMResponse } from './types.js';

export interface OpenAICompatibleConfig {
  /** Base URL including version path, e.g. "https://api.openai.com/v1" or "http://localhost:11434/v1". */
  baseUrl: string;
  model: string;
  /** Sent as a Bearer token. Optional for local servers that do not require auth. */
  apiKey?: string;
  /**
   * Send `response_format: { type: "json_object" }` when JSON is requested. Default true.
   * Disable for servers that reject the parameter.
   */
  jsonMode?: boolean;
  /** Extra headers, e.g. for gateways. */
  headers?: Record<string, string>;
  /** Override for testing or custom transports. Defaults to global fetch. */
  fetch?: typeof fetch;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Provider for any server implementing the OpenAI Chat Completions API
 * (`POST {baseUrl}/chat/completions`). This covers OpenAI itself and many
 * self-hosted/gateway options such as Ollama, vLLM and LM Studio.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAICompatibleConfig) {
    if (!config.baseUrl) throw new ProviderError('OpenAICompatibleProvider: baseUrl is required');
    if (!config.model) throw new ProviderError('OpenAICompatibleProvider: model is required');
    this.model = config.model;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: request.messages,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.responseFormat === 'json' && this.config.jsonMode !== false) {
      body.response_format = { type: 'json_object' };
    }

    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (cause) {
      throw new ProviderError(`Request to ${url} failed`, undefined, { cause });
    }

    if (!response.ok) {
      // Include a short slice of the body for debugging; never echo request headers (they hold the key).
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw new ProviderError(`LLM request failed with HTTP ${response.status}: ${detail}`, response.status);
    }

    const json = (await response.json()) as ChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ProviderError('LLM response did not contain choices[0].message.content');
    }
    return {
      content,
      model: json.model ?? this.config.model,
      usage: json.usage
        ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
        : undefined,
    };
  }
}
