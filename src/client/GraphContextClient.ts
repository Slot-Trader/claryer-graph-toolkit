import { buildAnalysisMessages } from '../analysis/prompt.js';
import { parseAnalysis } from '../analysis/parse.js';
import { formatContext } from '../context/formatContext.js';
import { NotFoundError } from '../errors.js';
import type { GraphStore } from '../graph/GraphStore.js';
import { normalizeConversation } from '../input/normalize.js';
import type { LLMProvider } from '../llm/types.js';
import type {
  AnalysisResult,
  ContextOptions,
  Conversation,
  ConversationInput,
  Decision,
  GraphContext,
} from '../types/index.js';

export interface GraphContextClientOptions {
  /** Where the conversation graph lives, e.g. `Neo4jGraphStore.connect(...)` or `new InMemoryGraphStore()`. */
  graph: GraphStore;
  /** Which model analyzes conversations. Any `LLMProvider` implementation. */
  llm: LLMProvider;
  /** Default limits for graph context retrieval. */
  context?: ContextOptions;
  /** Character budget for the context block sent to the LLM. Default 24 000. */
  maxContextChars?: number;
}

export interface AnalyzeOptions {
  /** Override context retrieval limits for this call. */
  context?: ContextOptions;
  /** Extra instructions appended to the prompt, e.g. "Focus on deadlines". */
  instructions?: string;
  /**
   * Write decisions identified by the analysis back to the graph as `Decision` nodes
   * (with `source: "analysis"`), so future analyses see them as related context. Default false.
   */
  persistDecisions?: boolean;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * High-level entry point: store conversations as a graph, retrieve their context,
 * and ask an LLM for a structured analysis.
 *
 * @example
 * const client = new GraphContextClient({
 *   graph: Neo4jGraphStore.connect({ uri, username, password }),
 *   llm: new OpenAICompatibleProvider({ baseUrl, apiKey, model }),
 * });
 * await client.init();
 * const conversation = await client.addConversation(input);
 * const analysis = await client.analyzeConversation(conversation.id);
 */
export class GraphContextClient {
  readonly graph: GraphStore;
  readonly llm: LLMProvider;

  constructor(private readonly options: GraphContextClientOptions) {
    this.graph = options.graph;
    this.llm = options.llm;
  }

  /** Prepares the graph store (creates Neo4j constraints). Call once at startup. */
  async init(): Promise<void> {
    await this.graph.init();
  }

  /**
   * Validates and stores a conversation. Returns the normalized conversation,
   * including any generated ids.
   *
   * @throws ValidationError if the input is invalid.
   */
  async addConversation(input: ConversationInput): Promise<Conversation> {
    const conversation = normalizeConversation(input);
    await this.graph.saveConversation(conversation);
    return conversation;
  }

  getConversation(conversationId: string): Promise<Conversation | null> {
    return this.graph.getConversation(conversationId);
  }

  /** Retrieves the conversation plus related decisions and conversations from the graph. */
  async getContext(conversationId: string, options?: ContextOptions): Promise<GraphContext> {
    const context = await this.graph.getContext(conversationId, { ...this.options.context, ...options });
    if (!context) throw new NotFoundError(`Conversation "${conversationId}" not found`);
    return context;
  }

  /**
   * Retrieves graph context for a stored conversation, sends it to the LLM, and returns
   * a validated, structured analysis.
   *
   * @throws NotFoundError if the conversation is not stored.
   * @throws ProviderError if the LLM call fails.
   * @throws AnalysisParseError if the LLM output cannot be parsed.
   */
  async analyzeConversation(conversationId: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
    const context = await this.getContext(conversationId, options.context);
    const contextText = formatContext(context, { maxChars: this.options.maxContextChars });

    const response = await this.llm.complete({
      messages: buildAnalysisMessages(contextText, options.instructions),
      responseFormat: 'json',
      temperature: options.temperature ?? 0,
      signal: options.signal,
    });

    const result = parseAnalysis(response.content, context.conversation, {
      name: this.llm.name,
      model: response.model ?? this.llm.model,
    });

    if (options.persistDecisions && result.decisions.length > 0) {
      await this.graph.saveDecisions(toDecisions(result, context.conversation));
    }
    return result;
  }

  async close(): Promise<void> {
    await this.graph.close();
  }
}

function toDecisions(result: AnalysisResult, conversation: Conversation): Decision[] {
  const existing = new Set(conversation.decisions.map((d) => d.description.trim().toLowerCase()));
  return result.decisions
    .filter((d) => !existing.has(d.description.trim().toLowerCase()))
    .map((d, i) => ({
      id: `${conversation.id}_analysis_dec_${i + 1}`,
      conversationId: conversation.id,
      description: d.description,
      assignedTo: d.owner ? [d.owner] : [],
      topicIds: [],
      source: 'analysis' as const,
    }));
}
