import type { LLMProvider, LLMRequest, LLMResponse } from './types.js';

export type MockResponder = string | ((request: LLMRequest) => string | Promise<string>);

/**
 * Deterministic provider for tests and offline demos. It does NOT call any model:
 * it returns whatever the responder gives it, and records every request.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model = 'mock';
  readonly requests: LLMRequest[] = [];

  constructor(private readonly responder: MockResponder) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request);
    const content = typeof this.responder === 'string' ? this.responder : await this.responder(request);
    return { content, model: this.model };
  }
}
