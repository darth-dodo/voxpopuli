import { AIMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeWithRetry } from '../../llm/invoke-with-retry';
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

/** Schema for the Writer's input payload — analysis + citation sources only, no evidence. */
export const WriterInputSchema = z.object({
  analysis: AnalysisResultSchema,
  sources: z.array(SourceMetadataSchema),
});
type WriterInput = z.infer<typeof WriterInputSchema>;

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

export function createWriterNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
    analysis: AnalysisResult;
  }): Promise<{ response: AgentResponseV2; inputTokens: number; outputTokens: number }> => {
    let inputTokens = 0;
    let outputTokens = 0;

    const writerInput: WriterInput = {
      analysis: state.analysis,
      sources: state.bundle.allSources,
    };
    const input = JSON.stringify(writerInput);

    const messages: BaseMessage[] = [
      new SystemMessage(WRITER_SYSTEM_PROMPT),
      new HumanMessage(input),
    ];

    // First attempt
    const firstAttempt = await invokeWithRetry(model, messages, {
      metadata: { pipeline_stage: 'writer', query: state.query },
      tags: ['multi-agent', 'writer'],
    });
    const t1 = extractTokens(firstAttempt);
    inputTokens += t1.input;
    outputTokens += t1.output;
    const firstContent = typeof firstAttempt.content === 'string' ? firstAttempt.content : '';

    let response: AgentResponseV2;

    try {
      const parsed = JSON.parse(cleanLlmOutput(firstContent));
      const result = AgentResponseV2Schema.safeParse(parsed);
      if (result.success) {
        response = result.data;
      } else {
        messages.push(
          new AIMessage(firstContent),
          new HumanMessage(
            `Validation errors:\n${JSON.stringify(
              result.error.issues,
              null,
              2,
            )}\n\nRespond with valid JSON only.`,
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
        response = AgentResponseV2Schema.parse(JSON.parse(cleanLlmOutput(retryContent)));
      }
    } catch {
      messages.push(
        new AIMessage(firstContent),
        new HumanMessage(
          'Your response was not valid JSON. Respond with valid JSON only, no markdown fencing.',
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
      response = AgentResponseV2Schema.parse(JSON.parse(cleanLlmOutput(retryContent)));
    }

    return { response, inputTokens, outputTokens };
  };
}
