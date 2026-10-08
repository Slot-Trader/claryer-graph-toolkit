import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryGraphStore,
  MockProvider,
  NAtlasProvider,
  Neo4jGraphStore,
  NotImplementedError,
  OpenAICompatibleProvider,
  ProviderError,
  graphStoreFromEnv,
  llmProviderFromEnv,
} from '../src/index.js';
import type { LLMProvider, LLMRequest } from '../src/index.js';

const request: LLMRequest = {
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ],
  responseFormat: 'json',
  temperature: 0,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('OpenAICompatibleProvider', () => {
  it('sends a chat completions request and maps the response', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ model: 'm-1', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
    );
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://llm.example.test/v1/', model: 'm-1', apiKey: 'test-key', fetch });

    const res = await provider.complete(request);

    expect(res).toEqual({ content: '{"ok":true}', model: 'm-1', usage: { inputTokens: 3, outputTokens: 4 } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'm-1',
      messages: request.messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
  });

  it('omits auth and response_format when not configured', async () => {
    const fetch = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'x' } }] }));
    const provider = new OpenAICompatibleProvider({ baseUrl: 'http://localhost:11434/v1', model: 'local', jsonMode: false, fetch });
    await provider.complete(request);
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(init.body as string)).not.toHaveProperty('response_format');
  });

  it('throws ProviderError with status on HTTP errors, without leaking the key', async () => {
    const fetch = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://x.test/v1', model: 'm', apiKey: 'secret-key', fetch });
    const error = await provider.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(429);
    expect((error as Error).message).not.toContain('secret-key');
  });

  it('throws ProviderError on network failure and malformed responses', async () => {
    const failing = new OpenAICompatibleProvider({ baseUrl: 'https://x.test/v1', model: 'm', fetch: vi.fn(async () => { throw new TypeError('ECONNREFUSED'); }) });
    await expect(failing.complete(request)).rejects.toBeInstanceOf(ProviderError);
    const malformed = new OpenAICompatibleProvider({ baseUrl: 'https://x.test/v1', model: 'm', fetch: vi.fn(async () => jsonResponse({ choices: [] })) });
    await expect(malformed.complete(request)).rejects.toThrow(/choices\[0\]/);
  });

  it('requires baseUrl and model', () => {
    expect(() => new OpenAICompatibleProvider({ baseUrl: '', model: 'm' })).toThrow(ProviderError);
    expect(() => new OpenAICompatibleProvider({ baseUrl: 'u', model: '' })).toThrow(ProviderError);
  });
});

describe('MockProvider', () => {
  it('returns static or computed responses and records requests', async () => {
    const fixed = new MockProvider('hello');
    expect((await fixed.complete(request)).content).toBe('hello');
    expect(fixed.requests).toEqual([request]);

    const computed = new MockProvider((req) => `echo:${req.messages.at(-1)!.content}`);
    expect((await computed.complete(request)).content).toBe('echo:hi');
  });
});

describe('NAtlasProvider (template)', () => {
  it('implements the provider interface but refuses to run until implemented', async () => {
    const provider: LLMProvider = new NAtlasProvider({ model: 'placeholder' });
    expect(provider.name).toBe('n-atlas');
    await expect(provider.complete(request)).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe('custom providers', () => {
  it('any object satisfying LLMProvider can be used', async () => {
    const custom: LLMProvider = { name: 'custom', complete: async () => ({ content: 'ok' }) };
    expect((await custom.complete(request)).content).toBe('ok');
  });
});

describe('environment factories', () => {
  it('builds providers from env', () => {
    expect(llmProviderFromEnv({})).toBeInstanceOf(MockProvider);
    expect(llmProviderFromEnv({ LLM_PROVIDER: 'natlas' })).toBeInstanceOf(NAtlasProvider);
    expect(
      llmProviderFromEnv({ LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://x', LLM_MODEL: 'm' }),
    ).toBeInstanceOf(OpenAICompatibleProvider);
    expect(() => llmProviderFromEnv({ LLM_PROVIDER: 'openai-compatible' })).toThrow(/LLM_BASE_URL/);
    expect(() => llmProviderFromEnv({ LLM_PROVIDER: 'other' })).toThrow(/Unknown LLM_PROVIDER/);
  });

  it('builds graph stores from env', async () => {
    expect(graphStoreFromEnv({})).toBeInstanceOf(InMemoryGraphStore);
    expect(() => graphStoreFromEnv({ GRAPH_BACKEND: 'neo4j' })).toThrow(/NEO4J_URI/);
    // The driver connects lazily, so constructing does not need a running database.
    const store = graphStoreFromEnv({ GRAPH_BACKEND: 'neo4j', NEO4J_URI: 'bolt://localhost:7687', NEO4J_USERNAME: 'u', NEO4J_PASSWORD: 'p' });
    expect(store).toBeInstanceOf(Neo4jGraphStore);
    await store.close();
  });
});
