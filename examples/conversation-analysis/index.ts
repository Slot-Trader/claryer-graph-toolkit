/**
 * End-to-end example: store two related conversations, retrieve graph context,
 * and ask an LLM for a structured miscommunication analysis.
 *
 *   npm run example                                   # offline: in-memory graph + scripted mock LLM
 *   GRAPH_BACKEND=neo4j npm run example               # real Neo4j (see .env.example)
 *   LLM_PROVIDER=openai-compatible npm run example    # real model
 */
import 'dotenv/config';
import { GraphContextClient, formatContext, graphStoreFromEnv, llmProviderFromEnv } from '../../src/index.js';
import { followUpChat, planningCall, scriptedAnalysis } from './sample-data.js';

async function main() {
  const client = new GraphContextClient({
    graph: graphStoreFromEnv(),
    llm: llmProviderFromEnv(process.env, scriptedAnalysis),
  });

  console.log(`Graph backend: ${process.env.GRAPH_BACKEND ?? 'memory'} | LLM provider: ${client.llm.name}`);
  if (client.llm.name === 'mock') {
    console.log('⚠️  Using the mock provider: the analysis below is a SCRIPTED example, not model output.\n');
  }

  try {
    await client.init();

    // 1. Store conversations. The earlier one contains a decision the later one contradicts.
    await client.addConversation(planningCall);
    const conversation = await client.addConversation(followUpChat);
    console.log(`Stored ${conversation.messages.length} messages in "${conversation.title}".\n`);

    // 2. Retrieve graph context for the new conversation.
    const context = await client.getContext(conversation.id);
    console.log('── Graph context retrieved ─────────────────────────────');
    for (const d of context.relatedDecisions) console.log(`  decision  ${d.description}  [${d.conversationId}]`);
    for (const c of context.relatedConversations) {
      console.log(`  related   ${c.title ?? c.id}  (people: ${c.sharedParticipantIds.join(', ') || '-'}; topics: ${c.sharedTopicIds.join(', ') || '-'})`);
    }

    console.log('\n── What the LLM receives ───────────────────────────────');
    console.log(formatContext(context));

    // 3. Analyze: conversation + graph context → LLM → validated structured result.
    const analysis = await client.analyzeConversation(conversation.id);
    console.log('\n── Structured analysis ─────────────────────────────────');
    console.log(JSON.stringify(analysis, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
