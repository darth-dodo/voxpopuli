import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { EvidenceBundleSchema, type EvidenceBundle } from '@voxpopuli/shared-types';
import { RETRIEVER_SYSTEM_PROMPT } from '../prompts/retriever.prompt';
import { COMPACTOR_SYSTEM_PROMPT } from '../prompts/compactor.prompt';
import { cleanLlmOutput } from './parse-llm-json';

const MAX_REACT_ITERATIONS = 8;

/**
 * Creates the Retriever node function for the pipeline.
 *
 * Two phases:
 * 1. ReAct loop (createReactAgent) — collects raw HN data via tools
 * 2. Compaction (single LLM call) — converts raw data → EvidenceBundle
 */
export function createRetrieverNode(model: BaseChatModel, tools: StructuredToolInterface[]) {
  const reactAgent = createReactAgent({
    llm: model,
    tools,
    prompt: RETRIEVER_SYSTEM_PROMPT.replace(
      '{{maxIterations}}',
      String(MAX_REACT_ITERATIONS),
    ).replace('{{currentDate}}', new Date().toISOString().split('T')[0]),
  });

  return async (state: {
    query: string;
    events: unknown[];
  }): Promise<{ bundle: EvidenceBundle; events: unknown[] }> => {
    const startTime = Date.now();
    const events = [...state.events];

    events.push({
      stage: 'retriever',
      status: 'started',
      detail: `Searching HN for "${state.query}"...`,
      elapsed: 0,
    });

    // Phase 1: ReAct collection
    const reactResult = await reactAgent.invoke({
      messages: [new HumanMessage(state.query)],
    });

    const rawData = reactResult.messages
      .map((m: { content: unknown }) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n\n');

    // Phase 2: Compaction
    events.push({
      stage: 'retriever',
      status: 'progress',
      detail: 'Compacting sources into themes...',
      elapsed: Date.now() - startTime,
    });

    const bundle = await compactWithRetry(model, state.query, rawData);

    events.push({
      stage: 'retriever',
      status: 'done',
      detail: `${bundle.themes.length} themes from ${bundle.allSources.length} sources (~${bundle.tokenCount} tokens)`,
      elapsed: Date.now() - startTime,
    });

    return { bundle, events };
  };
}

/**
 * Compact raw HN data into an EvidenceBundle with one retry on parse failure.
 */
async function compactWithRetry(
  model: BaseChatModel,
  query: string,
  rawData: string,
): Promise<EvidenceBundle> {
  const messages: Array<SystemMessage | HumanMessage | { role: string; content: string }> = [
    new SystemMessage(COMPACTOR_SYSTEM_PROMPT),
    new HumanMessage(`Query: ${query}\n\nRaw HN data:\n${rawData.slice(0, 50_000)}`),
  ];

  const firstAttempt = await model.invoke(messages);
  const firstContent = typeof firstAttempt.content === 'string' ? firstAttempt.content : '';

  try {
    const parsed = JSON.parse(cleanLlmOutput(firstContent));
    const result = EvidenceBundleSchema.safeParse(parsed);
    if (result.success) return result.data;

    // Retry with error details
    messages.push(
      { role: 'assistant', content: firstContent },
      new HumanMessage(
        `Your previous response had validation errors:\n${JSON.stringify(
          result.error.issues,
          null,
          2,
        )}\n\nRespond with valid JSON only, no markdown fencing.`,
      ),
    );
  } catch {
    messages.push(
      { role: 'assistant', content: firstContent },
      new HumanMessage(
        'Your previous response was not valid JSON. Respond with valid JSON only, no markdown fencing.',
      ),
    );
  }

  const retryAttempt = await model.invoke(messages);
  const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
  const parsed = JSON.parse(cleanLlmOutput(retryContent));
  return EvidenceBundleSchema.parse(parsed);
}
