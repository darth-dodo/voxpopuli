import { AIMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { invokeWithRetry } from '../../llm/invoke-with-retry';
import { WriterDraftStreamer } from './writer-draft';
import { formatBundleForSynthesizer } from './synthesizer.node';
import { MERGED_WRITER_SYSTEM_PROMPT } from '../prompts/merged-writer.prompt';
import {
  AgentResponseV2Schema,
  AnalysisResultSchema,
  SourceMetadataSchema,
  type AgentResponseV2,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';
import { z } from 'zod';
import { WRITER_SYSTEM_PROMPT } from '../prompts/writer.prompt';
import { cleanLlmOutput } from './parse-llm-json';
import { formatQuestionContext } from './question-context';

/** Schema for the Writer's input payload — analysis + citation sources only, no evidence. */
export const WriterInputSchema = z.object({
  analysis: AnalysisResultSchema,
  sources: z.array(SourceMetadataSchema),
});
type WriterInput = z.infer<typeof WriterInputSchema>;

/**
 * What the LLM actually generates. `sources` is attached from the bundle by
 * code — copying the citation table back out cost ~1-2k output tokens per run.
 */
const WriterOutputSchema = AgentResponseV2Schema.omit({ sources: true });
type WriterOutput = z.infer<typeof WriterOutputSchema>;

/**
 * Creates the Writer node function for the pipeline.
 * Single-pass: AnalysisResult + citation table → AgentResponseV2.
 */
/** Extract token counts from a LangChain AI message response. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTokens(msg: any): { input: number; output: number } {
  const usage = msg?.usage_metadata;
  return { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 };
}

/** Text of a message chunk; Anthropic streams arrays of content blocks rather than strings. */
function chunkText(content: AIMessageChunk['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .join('');
}

/**
 * Stream the Writer's first attempt, emitting append-only markdown deltas of the
 * answer as it is written (the UI renders them as a live draft), and return the
 * same AIMessage shape `invokeWithRetry` would.
 *
 * If the provider fails before producing output, fall back to `invokeWithRetry`
 * (which also handles TPM truncation). A failure mid-stream is rethrown so the
 * node's retry wrapper runs the Writer again.
 */
async function streamWithDraft(
  model: BaseChatModel,
  messages: BaseMessage[],
  options: RunnableConfig,
  onDelta: (markdown: string) => void,
): Promise<AIMessage> {
  const drafter = new WriterDraftStreamer();
  let full: AIMessageChunk | undefined;
  let text = '';
  try {
    for await (const chunk of await model.stream(messages, options)) {
      full = full ? full.concat(chunk) : chunk;
      text += chunkText(chunk.content);
      const delta = drafter.push(text);
      if (delta) onDelta(delta);
    }
  } catch (err) {
    if (full) throw err;
    return invokeWithRetry(model, messages, options);
  }
  if (!full) return invokeWithRetry(model, messages, options);
  return new AIMessage({ content: text, usage_metadata: full.usage_metadata });
}

/**
 * @param options.fromEvidence - Merged mode: write straight from the evidence themes
 *   (one LLM call instead of Synthesizer + Writer). Confidence and gaps still come
 *   from `state.analysis`, which the merged Synthesizer node derives in code.
 */
export function createWriterNode(model: BaseChatModel, options: { fromEvidence?: boolean } = {}) {
  return async (
    state: {
      query: string;
      priorQuery?: string;
      bundle: EvidenceBundle;
      analysis: AnalysisResult;
    },
    config?: LangGraphRunnableConfig,
  ): Promise<{ response: AgentResponseV2; inputTokens: number; outputTokens: number }> => {
    let inputTokens = 0;
    let outputTokens = 0;

    const question = { query: state.query, priorQuery: state.priorQuery };
    let messages: BaseMessage[];
    if (options.fromEvidence) {
      const gaps = state.analysis.gaps.length ? state.analysis.gaps.join(' ') : 'none';
      messages = [
        new SystemMessage(MERGED_WRITER_SYSTEM_PROMPT),
        new HumanMessage(
          `${formatBundleForSynthesizer(state.bundle, question)}\n\n` +
            `Confidence: ${state.analysis.confidence}\nKnown gaps: ${gaps}`,
        ),
      ];
    } else {
      const writerInput: WriterInput = {
        analysis: state.analysis,
        sources: state.bundle.allSources,
      };
      messages = [
        new SystemMessage(WRITER_SYSTEM_PROMPT),
        new HumanMessage(`${formatQuestionContext(question)}\n\n${JSON.stringify(writerInput)}`),
      ];
    }

    // First attempt — streamed as a live draft when the graph provides a writer.
    const callOptions: RunnableConfig = {
      metadata: { pipeline_stage: 'writer', query: state.query },
      tags: ['multi-agent', 'writer'],
    };
    const emit = config?.writer;
    const firstAttempt = emit
      ? await streamWithDraft(model, messages, callOptions, (delta) =>
          emit({ type: 'writer_draft', data: delta }),
        )
      : await invokeWithRetry(model, messages, callOptions);
    const t1 = extractTokens(firstAttempt);
    inputTokens += t1.input;
    outputTokens += t1.output;
    const firstContent = typeof firstAttempt.content === 'string' ? firstAttempt.content : '';

    let output: WriterOutput;

    try {
      const parsed = JSON.parse(cleanLlmOutput(firstContent));
      const result = WriterOutputSchema.safeParse(parsed);
      if (result.success) {
        output = result.data;
      } else {
        messages.push(
          new AIMessage(firstContent),
          new HumanMessage(
            `Validation errors:\n${JSON.stringify(
              result.error.issues,
              null,
              2,
            )}\n\nRespond with the COMPLETE corrected JSON object only.`,
          ),
        );
        const retryAttempt = await invokeWithRetry(model, messages, {
          metadata: { pipeline_stage: 'writer', query: state.query },
          tags: ['multi-agent', 'writer'],
        });
        const t2 = extractTokens(retryAttempt);
        inputTokens += t2.input;
        outputTokens += t2.output;
        const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
        output = WriterOutputSchema.parse(JSON.parse(cleanLlmOutput(retryContent)));
      }
    } catch {
      messages.push(
        new AIMessage(firstContent),
        new HumanMessage(
          'Your response was not valid JSON. Respond with the COMPLETE JSON object only, no markdown fencing.',
        ),
      );
      const retryAttempt = await invokeWithRetry(model, messages, {
        metadata: { pipeline_stage: 'writer', query: state.query },
        tags: ['multi-agent', 'writer'],
      });
      const t2 = extractTokens(retryAttempt);
      inputTokens += t2.input;
      outputTokens += t2.output;
      const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
      output = WriterOutputSchema.parse(JSON.parse(cleanLlmOutput(retryContent)));
    }

    const response: AgentResponseV2 = { ...output, sources: state.bundle.allSources };
    return { response, inputTokens, outputTokens };
  };
}
