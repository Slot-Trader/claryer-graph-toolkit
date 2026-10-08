import { GraphContextError } from '../errors.js';
import type { GraphStore } from '../graph/GraphStore.js';
import { InMemoryGraphStore } from '../graph/InMemoryGraphStore.js';
import { Neo4jGraphStore } from '../graph/Neo4jGraphStore.js';
import { MockProvider } from '../llm/MockProvider.js';
import type { MockResponder } from '../llm/MockProvider.js';
import { NAtlasProvider } from '../llm/NAtlasProvider.js';
import { OpenAICompatibleProvider } from '../llm/OpenAICompatibleProvider.js';
import type { LLMProvider } from '../llm/types.js';

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new GraphContextError(`Missing required environment variable ${key} (see .env.example)`);
  return value;
}

/**
 * Builds a GraphStore from environment variables.
 * GRAPH_BACKEND=neo4j (requires NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD) or memory (default).
 */
export function graphStoreFromEnv(env: Env = process.env): GraphStore {
  const backend = (env.GRAPH_BACKEND ?? 'memory').toLowerCase();
  switch (backend) {
    case 'memory':
      return new InMemoryGraphStore();
    case 'neo4j':
      return Neo4jGraphStore.connect({
        uri: required(env, 'NEO4J_URI'),
        username: required(env, 'NEO4J_USERNAME'),
        password: required(env, 'NEO4J_PASSWORD'),
        database: env.NEO4J_DATABASE || undefined,
      });
    default:
      throw new GraphContextError(`Unknown GRAPH_BACKEND "${backend}" (expected "neo4j" or "memory")`);
  }
}

/**
 * Builds an LLMProvider from environment variables.
 * LLM_PROVIDER=openai-compatible | natlas | mock (default: mock).
 *
 * @param mockResponder Response used when LLM_PROVIDER=mock.
 */
export function llmProviderFromEnv(env: Env = process.env, mockResponder: MockResponder = '{}'): LLMProvider {
  const provider = (env.LLM_PROVIDER ?? 'mock').toLowerCase();
  switch (provider) {
    case 'mock':
      return new MockProvider(mockResponder);
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        baseUrl: required(env, 'LLM_BASE_URL'),
        model: required(env, 'LLM_MODEL'),
        apiKey: env.LLM_API_KEY || undefined,
      });
    case 'natlas':
      return new NAtlasProvider({
        baseUrl: env.NATLAS_BASE_URL || undefined,
        apiKey: env.NATLAS_API_KEY || undefined,
        model: env.NATLAS_MODEL || undefined,
      });
    default:
      throw new GraphContextError(
        `Unknown LLM_PROVIDER "${provider}" (expected "openai-compatible", "natlas" or "mock")`,
      );
  }
}
