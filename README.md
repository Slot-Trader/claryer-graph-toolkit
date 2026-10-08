# graph-context-kit

**A TypeScript toolkit for building graph-based conversational AI.** Store conversations as a Neo4j knowledge graph (people, messages, decisions, topics), retrieve the relationship context that matters, and get **structured, validated analysis** from any LLM through a swappable provider interface.

```ts
const client = new GraphContextClient({
  graph: Neo4jGraphStore.connect({ uri, username, password }),
  llm: new OpenAICompatibleProvider({ baseUrl, apiKey, model }),
});

await client.init();
const conversation = await client.addConversation(input);
const analysis = await client.analyzeConversation(conversation.id);
// → { summary, decisions[{ interpretations }], risks[{ severity, evidenceMessageIds }], suggestedClarifications }
```

---

## Contents

- [Why it exists](#why-it-exists)
- [Features](#features)
- [Architecture overview](#architecture-overview)
- [Requirements](#requirements)
- [Installation](#installation)
- [Environment setup](#environment-setup)
- [Neo4j setup](#neo4j-setup)
- [Quick start](#quick-start)
- [API usage](#api-usage)
- [Example: miscommunication detection](#example-miscommunication-detection)
- [Graph model](#graph-model)
- [LLM provider architecture](#llm-provider-architecture)
- [N-ATLAS integration status](#n-atlas-integration-status)
- [Running tests](#running-tests)
- [Security and privacy notes](#security-and-privacy-notes)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

---

## Why it exists

When an LLM analyzes a single conversation on its own, it misses things like:

- *"We already agreed the demo is on Tuesday."* That was decided in a **different** conversation.
- *"Tunde owns the demo environment."* That was a responsibility assigned last week.
- *"These two people have discussed this topic three times."*

That context lives in the **relationships** between people, conversations, decisions, and topics. A graph database models those relationships naturally, and querying it before calling the LLM grounds the model in what the team has already said and decided.

This toolkit packages that pattern (*store conversations as a graph → retrieve related context → prompt an LLM → validate structured output*) into a small, readable library. It was inspired by patterns explored while building **Claryer**, an assistant that detects miscommunication in remote teams. It is an independent, generic toolkit: it contains no Claryer product code, data, or configuration.

## Features

- **Structured conversation input** with validation (zod). It reports every problem at once: unknown senders, duplicate ids, bad dates.
- **Neo4j graph store** with idempotent upserts, uniqueness constraints, and fully parameterized Cypher.
- **In-memory graph store** with the same semantics, for tests, demos, and prototyping without a database. The integration tests check that both stores return identical results.
- **Context retrieval:** related conversations (ranked by shared people and topics) and related decisions from other conversations that involve the same people or topics.
- **Context formatting** for prompts, with a character budget. It cites message ids so the model can reference evidence.
- **Provider-agnostic LLM layer:**
  - one small `LLMProvider` interface
  - an OpenAI-compatible provider (OpenAI, Ollama, vLLM, LM Studio, gateways)
  - a mock provider for tests
  - a clearly marked N-ATLAS template
- **Validated structured results:** model output is parsed, schema-checked, and stripped of person or message ids that don't exist in the conversation (a hallucination guard).
- **Optional write-back:** decisions found by an analysis can be stored in the graph, so later analyses can see them.

## Architecture overview

```
            ConversationInput
                   │
                   ▼
   ┌─────────────────────────────────┐
   │   GraphContextClient            │  src/client
   │  addConversation / getContext / │
   │  analyzeConversation            │
   └──┬───────────┬───────────────┬──┘
      │           │               │
      ▼           ▼               ▼
 normalize     GraphStore      LLMProvider
 (validate)    interface       interface
 src/input     src/graph       src/llm
               ├ Neo4jGraphStore      ├ OpenAICompatibleProvider
               └ InMemoryGraphStore   ├ MockProvider
                                      └ NAtlasProvider (template)
      GraphContext ──► formatContext ──► prompt ──► LLM ──► parseAnalysis ──► AnalysisResult
                       src/context       src/analysis           src/analysis
```

| Directory | Responsibility |
| --- | --- |
| `src/types` | Public types: inputs, graph entities, context, analysis results |
| `src/input` | Validation and normalization of `ConversationInput` |
| `src/graph` | `GraphStore` interface, Neo4j and in-memory implementations |
| `src/context` | Renders graph context into prompt text within a budget |
| `src/llm` | `LLMProvider` interface and providers |
| `src/analysis` | Analysis prompt and validated JSON parsing |
| `src/client` | `GraphContextClient` facade and env-based factories |
| `src/utils` | Small helpers (ids, slugs, mention detection) |

## Requirements

- **Node.js 20+** and npm
- **Neo4j 5.x**, only if you use the Neo4j backend. Docker is the easiest way to run it locally. The in-memory backend needs nothing.
- **An LLM endpoint**, only for real analyses. Any server implementing the OpenAI Chat Completions API works. The mock provider runs offline.

## Installation

The package is not yet published to npm. Clone and install:

```bash
git clone https://github.com/Slot-Trader/claryer-graph-toolkit.git
cd claryer-graph-toolkit
npm install
npm run build   # optional: compiles to dist/
```

## Environment setup

```bash
cp .env.example .env
```

| Variable | Used for | Default |
| --- | --- | --- |
| `GRAPH_BACKEND` | `neo4j` or `memory` | `memory` |
| `NEO4J_URI` | Bolt URI, e.g. `bolt://localhost:7687` | (required for neo4j) |
| `NEO4J_USERNAME` / `NEO4J_PASSWORD` | Neo4j credentials | (required for neo4j) |
| `NEO4J_DATABASE` | Database name | server default |
| `LLM_PROVIDER` | `mock`, `openai-compatible`, or `natlas` | `mock` |
| `LLM_BASE_URL` | e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1` | (required for openai-compatible) |
| `LLM_MODEL` | Model name for your endpoint | (required for openai-compatible) |
| `LLM_API_KEY` | Bearer token (optional for local servers) | none |
| `NATLAS_*` | Reserved for the N-ATLAS adapter (not yet functional) | none |

These variables are read by `graphStoreFromEnv()` and `llmProviderFromEnv()`, which the example uses. When you use the library directly, you can pass configuration objects instead.

## Neo4j setup

**Option A: Docker (recommended).** A compose file is included:

```bash
# Uses NEO4J_PASSWORD from your .env (Neo4j requires at least 8 characters)
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

The Neo4j Browser is then at http://localhost:7474 and Bolt at `bolt://localhost:7687`. Data is kept in `./neo4j-data`, which is git-ignored.

**Option B:** use [Neo4j Desktop](https://neo4j.com/download/) or a [Neo4j AuraDB](https://neo4j.com/cloud/platform/aura-graph-database/) instance. Put its URI and credentials in `.env`.

Call `client.init()` (or `store.init()`) once. It creates a uniqueness constraint on `id` for each node label and is safe to run repeatedly.

## Quick start

Run the example. It works offline with **zero configuration**, using the in-memory graph and a scripted mock response:

```bash
npm install
npm run example
```

Then switch on real services one at a time in `.env`:

```bash
GRAPH_BACKEND=neo4j npm run example                # real graph, scripted analysis
LLM_PROVIDER=openai-compatible npm run example     # real model analysis
```

When the mock provider is active, the example prints a warning that the analysis is **scripted, not model output**.

## API usage

### Create a client

```ts
import {
  GraphContextClient,
  Neo4jGraphStore,
  OpenAICompatibleProvider,
} from 'graph-context-kit'; // or '../src/index.js' inside this repo

const client = new GraphContextClient({
  graph: Neo4jGraphStore.connect({
    uri: process.env.NEO4J_URI!,
    username: process.env.NEO4J_USERNAME!,
    password: process.env.NEO4J_PASSWORD!,
  }),
  llm: new OpenAICompatibleProvider({
    baseUrl: process.env.LLM_BASE_URL!,
    model: process.env.LLM_MODEL!,
    apiKey: process.env.LLM_API_KEY,
  }),
  context: { maxRelatedConversations: 5, maxRelatedDecisions: 10 }, // optional defaults
  maxContextChars: 24_000,                                           // optional prompt budget
});
await client.init();
```

To build the same client from environment variables, use `graph: graphStoreFromEnv()` and `llm: llmProviderFromEnv()`.

### Add a conversation

```ts
const conversation = await client.addConversation({
  id: 'conv-42',                       // optional; generated if omitted
  title: 'Demo prep',
  startedAt: '2026-10-06T15:30:00Z',   // optional; defaults to now
  source: 'chat',                      // optional, free-form
  participants: [
    { id: 'amara', name: 'Amara Okafor', role: 'Product Lead' },
    { id: 'tunde', name: 'Tunde Bello' },
  ],
  topics: ['Client demo'],
  messages: [
    { id: 'm1', senderId: 'amara', text: '@tunde we need the demo build by Friday.' },
    { id: 'm2', senderId: 'tunde', text: 'Friday? I thought it was Tuesday.', topics: ['Deadline'] },
  ],
  decisions: [
    { description: 'Demo build due Friday', madeBy: 'amara', assignedTo: ['tunde'] },
  ],
});
```

- `@mentions` that match a participant's id or first name are detected automatically and stored as `MENTIONS` relationships. You can also pass `mentions: ['tunde']`.
- Topic names are turned into slug ids: `"Client demo"` → `client-demo`.
- Invalid input throws `ValidationError` with an `issues` array.
- **Ids are global.** Person ids identify the same person across conversations, which is what links them. Message and decision ids must be unique across the whole graph. If you omit them, they are generated with the conversation id as a prefix.

### Retrieve context

```ts
const context = await client.getContext('conv-42', { maxRelatedDecisions: 5 });
context.conversation;          // the stored conversation
context.relatedConversations;  // [{ id, title, startedAt, sharedParticipantIds, sharedTopicIds }]
context.relatedDecisions;      // decisions from OTHER conversations involving these people/topics
```

### Analyze

```ts
const analysis = await client.analyzeConversation('conv-42', {
  instructions: 'Focus on deadlines.', // optional, appended to the prompt
  persistDecisions: true,              // optional, store extracted decisions back in the graph
});
```

The result has this shape (`AnalysisResult`):

```ts
{
  conversationId: string;
  summary: string;
  decisions: { description: string; owner?: string;
               interpretations: { personId: string; understanding: string }[] }[];
  risks: { type: string; description: string; severity: 'low' | 'medium' | 'high';
           involvedPersonIds: string[]; evidenceMessageIds: string[] }[];
  suggestedClarifications: string[];
  provider: { name: string; model?: string };
}
```

Errors you may see:

| Error | When |
| --- | --- |
| `ValidationError` | Invalid conversation input |
| `NotFoundError` | The conversation id is not stored |
| `ProviderError` | Network or HTTP failure, or an unexpected response shape from the LLM (`.status` holds the HTTP code) |
| `AnalysisParseError` | The LLM replied, but not with valid JSON in the expected shape (`.rawOutput` holds the text) |
| `NotImplementedError` | You called the N-ATLAS template |

### Lower-level building blocks

Every stage is exported, so you can compose your own pipeline:

- `normalizeConversation`
- `formatContext`
- `buildAnalysisMessages`
- `parseAnalysis`
- `extractJson`
- `InMemoryGraphStore`, `Neo4jGraphStore`
- `MockProvider`

## Example: miscommunication detection

`examples/conversation-analysis/` contains a small, **fully fictional** scenario:

1. **Sprint planning (last week).** Amara and Tunde agree the client demo is on **Tuesday 14 Oct**, and Tunde is assigned the demo environment. This is stored with two `Decision` nodes.
2. **Demo prep chat (today).** Amara asks for "the demo build ready by Friday" (she means an internal walkthrough). Tunde replies he'll "present Friday", reading it as the demo moving. Release notes are mentioned, but nobody takes ownership.
3. The toolkit stores both conversations. When it retrieves context for the chat, the graph surfaces last week's *"Client demo will take place on Tuesday 14 Oct"* decision through the shared participants and the shared `client-demo` topic.
4. The LLM receives the transcript **plus** that graph context and returns:
   - each person's interpretation of the decision
   - a `conflicting-deadline` risk (high) and an `ambiguous-ownership` risk (medium), each citing message ids
   - suggested clarifying questions

```bash
npm run example
```

The output shows the retrieved graph context, the exact prompt context sent to the LLM, and the structured `AnalysisResult`. With `LLM_PROVIDER=mock`, the analysis is a hand-written fixture (`sample-data.ts`). Set `LLM_PROVIDER=openai-compatible` to get a real model's analysis of the same data.

## Graph model

All nodes have a unique `id` property, enforced by constraints that `init()` creates.

```
(:Person {id, name, role})
(:Conversation {id, title, startedAt, source})
(:Message {id, text, sentAt, seq})
(:Decision {id, description, source})        // source: "input" | "analysis"
(:Topic {id, name})

(:Person)-[:PARTICIPATED_IN]->(:Conversation)
(:Person)-[:SENT]->(:Message)
(:Message)-[:PART_OF]->(:Conversation)
(:Message)-[:MENTIONS]->(:Person)
(:Message)-[:MENTIONS]->(:Topic)
(:Person)-[:MADE_DECISION]->(:Decision)
(:Decision)-[:DECIDED_IN]->(:Conversation)
(:Decision)-[:ASSIGNED_TO]->(:Person)
(:Conversation)-[:RELATED_TO]->(:Topic)
(:Decision)-[:RELATED_TO]->(:Topic)
```

**How context is retrieved:**

- **Related conversations** are other conversations reachable through a shared `Person` (`PARTICIPATED_IN`) or a shared `Topic` (`RELATED_TO`). They are ranked by the number of shared people plus topics, then by recency.
- **Related decisions** come from other conversations. A decision counts if a participant made it or is assigned to it, or if it relates to one of the conversation's topics. They are ordered newest first.

**Extending the schema.** The model is deliberately generic. To add your own entities (for example `:Project`, `:Ticket`, or `:Commitment`), implement `GraphStore` or extend `Neo4jGraphStore`, and keep the `id` uniqueness convention. Because the client only depends on the `GraphStore` interface, you can also back it with a different graph database.

Here's a query you can try in Neo4j Browser after running the example:

```cypher
MATCH (p:Person)-[r]-(n) RETURN p, r, n
```

## LLM provider architecture

The toolkit depends on just one interface:

```ts
interface LLMProvider {
  readonly name: string;
  readonly model?: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}

interface LLMRequest {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  responseFormat?: 'text' | 'json';
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface LLMResponse { content: string; model?: string; usage?: { inputTokens?: number; outputTokens?: number } }
```

Included providers:

| Provider | Status | Notes |
| --- | --- | --- |
| `OpenAICompatibleProvider` | ✅ Working | `POST {baseUrl}/chat/completions`. Works with OpenAI and compatible servers such as Ollama, vLLM, and LM Studio. Set `jsonMode: false` if your server rejects `response_format`. |
| `MockProvider` | ✅ Working | Returns a fixed or computed string and records requests. For tests and offline demos. |
| `NAtlasProvider` | ⚠️ Template only | Throws `NotImplementedError`. See below. |

**Adding a provider.** Implement `complete()` and pass the instance as `llm`. No other changes are needed:

```ts
const myProvider: LLMProvider = {
  name: 'my-provider',
  async complete({ messages, responseFormat }) {
    const text = await callMyModel(messages, { json: responseFormat === 'json' });
    return { content: text };
  },
};
```

The analysis prompt asks for JSON whether or not the provider supports a native JSON mode. The parser also accepts output wrapped in Markdown code fences or surrounded by prose.

## N-ATLAS integration status

**Status: not integrated, adapter template only.**

N-ATLAS is not integrated because no verified, public N-ATLAS API documentation (endpoint, authentication, request and response format, or SDK) was available when this toolkit was written. Rather than invent one, the toolkit ships:

- `src/llm/NAtlasProvider.ts`: a class implementing `LLMProvider` with placeholder config (`baseUrl`, `apiKey`, `model`). Its `complete()` throws `NotImplementedError`. The file's header comment lists the exact integration steps.
- `LLM_PROVIDER=natlas` and the `NATLAS_*` variables, which are wired through `llmProviderFromEnv()`, so nothing else needs to change once the adapter is implemented.
- A test (`tests/llm.test.ts`) that pins down the current template behavior.

**To complete the integration:**

1. Obtain the official N-ATLAS API documentation or access details.
2. In `src/llm/NAtlasProvider.ts`, update `NAtlasConfig` to match the real requirements, then implement `complete()`. It should map `messages` to the official request format, apply the official authentication, map the response to `{ content, model, usage }`, and throw `ProviderError` on failures.
3. Replace the template test with tests that use a mocked `fetch` (copy the `OpenAICompatibleProvider` tests).
4. Update this section.

If your N-ATLAS deployment turns out to expose an OpenAI-compatible endpoint (for example, through a self-hosted inference server), you could use `OpenAICompatibleProvider` directly. Do this only after you have confirmed it for your deployment.

## Running tests

```bash
npm test               # unit tests (no external services; Neo4j and LLMs are mocked)
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm run check          # all three
```

The test suite covers:

- input validation and normalization
- in-memory graph operations
- the Neo4j store against a mocked driver (parameterized queries, transaction boundaries, row mapping, `LIMIT` integers)
- context retrieval and formatting
- the providers (mocked `fetch`)
- analysis parsing
- the client end to end

**Integration tests against a real Neo4j** are skipped by default:

```bash
# Requires NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD in .env or the environment.
# Creates and then DELETES nodes whose id starts with "it-". Use a dev database.
npm run test:integration
```

These tests check that `Neo4jGraphStore` returns exactly the same results as `InMemoryGraphStore`.

## Security and privacy notes

- **Credentials** come only from your environment or the config objects you pass. `.env` is git-ignored, and `.env.example` contains placeholders only. Never commit real keys.
- **Cypher injection:** every query is parameterized. No user input is ever interpolated into Cypher, and a unit test asserts this.
- **Errors** from the LLM provider include the HTTP status and a short slice of the response body. They never include request headers or your API key.
- **Conversation data is sent to your LLM provider.** Analyzing a conversation sends its transcript and related graph context to whatever endpoint you configure. Make sure you have consent and a legal basis for processing that data, and choose a provider whose data-retention terms fit your needs. A local model (for example, through Ollama) keeps the data on your own machine.
- **Stored data:** Neo4j holds message text and names. Apply your own retention, access control, and encryption policies, and consider pseudonymizing person ids.
- **LLM output is advisory.** Results are schema-validated, and ids are checked against the conversation, but the content is still a model's judgment. Treat it as a prompt for human follow-up, not as ground truth.
- The sample data in this repository is fictional.

## Limitations

- Context retrieval is structural (shared people and topics). There is no semantic or vector search yet.
- Re-saving a conversation upserts by id. It does not delete messages or decisions that were removed from the input.
- The context budget is measured in characters, not model tokens.
- Not yet published to npm.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branching, coding standards, and how to submit pull requests and issues.

## License

[MIT](LICENSE)
