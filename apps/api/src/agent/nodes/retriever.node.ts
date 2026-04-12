import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { EvidenceBundleSchema, type EvidenceBundle, type AgentStep } from '@voxpopuli/shared-types';
import { RETRIEVER_SYSTEM_PROMPT } from '../prompts/retriever.prompt';
import { COMPACTOR_SYSTEM_PROMPT } from '../prompts/compactor.prompt';
import { cleanLlmOutput } from './parse-llm-json';

const MAX_REACT_ITERATIONS = 8;

/**
 * Minimum raw data length (in chars) to consider the ReAct collection
 * as having found useful content. Below this threshold the compaction
 * LLM call is skipped and a minimal "dry-well" bundle is returned.
 */
const MIN_USEFUL_DATA_LENGTH = 200;

/**
 * Returns true when the raw data collected by the ReAct agent is too
 * sparse to justify a compaction LLM call. Two heuristics:
 *   1. Total content is very short (< MIN_USEFUL_DATA_LENGTH chars).
 *   2. No story-like data patterns (point counts, story IDs).
 */
export function isDryWell(rawData: string): boolean {
  const trimmed = rawData.trim();
  if (trimmed.length < MIN_USEFUL_DATA_LENGTH) return true;
  // Check for presence of any story-like content (point counts or story references)
  const hasStoryData = /\d+\s+points?/i.test(trimmed) || /Story\s+\d+/i.test(trimmed);
  return !hasStoryData;
}

/**
 * Builds a minimal EvidenceBundle for queries where the ReAct agent
 * found no substantial HN discussion ("dry well"). Skips the
 * compaction LLM call entirely to save tokens.
 */
export function buildDryWellBundle(query: string): EvidenceBundle {
  return {
    query,
    themes: [
      {
        label: 'No substantial discussion found',
        items: [
          {
            sourceId: 0,
            text: 'Limited or no relevant Hacker News discussion was found on this topic.',
            type: 'opinion' as const,
            relevance: 0.1,
          },
        ],
      },
    ],
    allSources: [],
    totalSourcesScanned: 0,
    tokenCount: 50,
  };
}

/**
 * Creates the Retriever node function for the pipeline.
 *
 * Two phases:
 * 1. ReAct loop (createReactAgent) — collects raw HN data via tools
 * 2. Compaction (single LLM call) — converts raw data → EvidenceBundle
 *
 * Returns the compacted EvidenceBundle and all AgentSteps accumulated
 * during the ReAct loop. The caller (pipeline graph) is responsible for
 * forwarding steps to the SSE stream.
 */
export type RetrieverResult = { bundle: EvidenceBundle; steps: AgentStep[] };

export function createRetrieverNode(model: BaseChatModel, tools: StructuredToolInterface[]) {
  const reactAgent = createReactAgent({
    llm: model,
    tools,
    prompt: RETRIEVER_SYSTEM_PROMPT.replace(
      '{{maxIterations}}',
      String(MAX_REACT_ITERATIONS),
    ).replace('{{currentDate}}', new Date().toISOString().split('T')[0]),
  });

  return async (state: { query: string }): Promise<RetrieverResult> => {
    const steps: AgentStep[] = [];

    // Phase 1: ReAct collection — accumulate steps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allMessages: any[] = [];

    const stream = await reactAgent.stream(
      { messages: [new HumanMessage(state.query)] },
      {
        metadata: { pipeline_stage: 'retriever', phase: 'react', query: state.query },
        tags: ['multi-agent', 'retriever', 'react'],
        streamMode: 'values',
      },
    );

    let prevMessageCount = 0;
    for await (const chunk of stream) {
      const messages = chunk.messages ?? [];
      // Accumulate steps for newly added messages
      if (messages.length > prevMessageCount) {
        for (let i = prevMessageCount; i < messages.length; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg = messages[i] as any;
          const type = typeof msg._getType === 'function' ? msg._getType() : undefined;
          const content = typeof msg.content === 'string' ? msg.content : '';

          if (type === 'ai' && msg.tool_calls?.length > 0) {
            for (const tc of msg.tool_calls) {
              const step: AgentStep = {
                type: 'action',
                content: `${tc.name}(${JSON.stringify(tc.args)})`,
                toolName: tc.name,
                toolInput: tc.args,
                timestamp: Date.now(),
              };
              steps.push(step);
              await dispatchCustomEvent('retriever_step', step);
            }
          } else if (type === 'tool') {
            const step: AgentStep = {
              type: 'observation',
              content: content.slice(0, 500),
              timestamp: Date.now(),
            };
            steps.push(step);
            await dispatchCustomEvent('retriever_step', step);
          } else if (type === 'ai' && content) {
            const step: AgentStep = {
              type: 'thought',
              content,
              timestamp: Date.now(),
            };
            steps.push(step);
            await dispatchCustomEvent('retriever_step', step);
          }
        }
      }
      prevMessageCount = messages.length;
      // Keep final messages for rawData extraction
      if (messages.length > 0) {
        allMessages.length = 0;
        allMessages.push(...messages);
      }
    }

    // Keep only tool results + assistant reasoning; drop system prompt and
    // the initial human query (already passed separately to compactWithRetry).
    const rawData = allMessages
      .filter((m: { _getType?: () => string }) => {
        if (typeof m._getType !== 'function') return true;
        const type = m._getType();
        return type !== 'system' && type !== 'human';
      })
      .map((m: { content: unknown }) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n\n');

    // Dry-well circuit breaker: if raw data is too sparse, skip compaction
    if (isDryWell(rawData)) {
      return { bundle: buildDryWellBundle(state.query), steps };
    }

    // Phase 2: Compaction
    const bundle = await compactWithRetry(model, state.query, rawData);

    return { bundle, steps };
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

  const firstAttempt = await model.invoke(messages, {
    metadata: { pipeline_stage: 'retriever', phase: 'compaction', query },
    tags: ['multi-agent', 'retriever', 'compaction'],
  });
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

  const retryAttempt = await model.invoke(messages, {
    metadata: { pipeline_stage: 'retriever', phase: 'compaction', query },
    tags: ['multi-agent', 'retriever', 'compaction'],
  });
  const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
  const parsed = JSON.parse(cleanLlmOutput(retryContent));
  return EvidenceBundleSchema.parse(parsed);
}
