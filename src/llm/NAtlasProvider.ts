import { NotImplementedError } from '../errors.js';
import type { LLMProvider, LLMRequest, LLMResponse } from './types.js';

/**
 * ⚠️  TEMPLATE — NOT A WORKING INTEGRATION.
 *
 * N-ATLAS adapter placeholder. At the time of writing, this project has no verified,
 * publicly documented N-ATLAS API (endpoint, authentication scheme, request/response
 * format, or SDK). Rather than guess, this class defines *where* the integration goes
 * and fails loudly if used.
 *
 * To complete the integration, using ONLY the official N-ATLAS documentation:
 *   1. Fill in `NAtlasConfig` with the fields the official API actually requires.
 *   2. Implement `complete()` below:
 *        a. Map `request.messages` (system/user/assistant) to the official request format.
 *        b. Apply the official authentication method.
 *        c. If the API supports structured/JSON output, honour `request.responseFormat === 'json'`;
 *           otherwise the toolkit's prompt already asks for JSON and the parser tolerates code fences.
 *        d. Map the response to `{ content, model, usage }`.
 *        e. Throw `ProviderError` (from ../errors.js) on HTTP/network failures.
 *   3. Remove the NotImplementedError and add tests in tests/llm.test.ts using a mocked `fetch`
 *      (see the OpenAICompatibleProvider tests for the pattern).
 *   4. Update the "N-ATLAS integration status" section of the README.
 *
 * If N-ATLAS turns out to be served behind an OpenAI-compatible endpoint (for example via a
 * self-hosted inference server), you can use `OpenAICompatibleProvider` directly instead —
 * but only do so once that is confirmed by the deployment you are using.
 */
export interface NAtlasConfig {
  /** Placeholder — confirm against official documentation. */
  baseUrl?: string;
  /** Placeholder — confirm against official documentation. */
  apiKey?: string;
  /** Placeholder — confirm against official documentation. */
  model?: string;
}

export class NAtlasProvider implements LLMProvider {
  readonly name = 'n-atlas';
  readonly model?: string;

  constructor(private readonly config: NAtlasConfig = {}) {
    this.model = config.model;
  }

  async complete(_request: LLMRequest): Promise<LLMResponse> {
    void this.config;
    throw new NotImplementedError(
      'NAtlasProvider is a template. Implement complete() in src/llm/NAtlasProvider.ts using the ' +
        'official N-ATLAS API documentation (see the README section "N-ATLAS integration status").',
    );
  }
}
