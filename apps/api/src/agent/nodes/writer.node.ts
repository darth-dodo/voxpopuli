import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
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
export function createWriterNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
    analysis: AnalysisResult;
  }): Promise<{ response: AgentResponseV2 }> => {
    const writerInput: WriterInput = {
      analysis: state.analysis,
      sources: state.bundle.allSources,
    };
    const input = JSON.stringify(writerInput);

    const messages: Array<SystemMessage | HumanMessage | { role: string; content: string }> = [
      new SystemMessage(WRITER_SYSTEM_PROMPT),
      new HumanMessage(input),
    ];

    // First attempt
    const firstAttempt = await model.invoke(messages, {
      metadata: { pipeline_stage: 'writer', query: state.query },
      tags: ['multi-agent', 'writer'],
    });
    const firstContent = typeof firstAttempt.content === 'string' ? firstAttempt.content : '';

    let response: AgentResponseV2;

    try {
      const parsed = JSON.parse(cleanLlmOutput(firstContent));
      const result = AgentResponseV2Schema.safeParse(parsed);
      if (result.success) {
        response = result.data;
      } else {
        messages.push(
          { role: 'assistant', content: firstContent },
          new HumanMessage(
            `Validation errors:\n${JSON.stringify(
              result.error.issues,
              null,
              2,
            )}\n\nRespond with valid JSON only.`,
          ),
        );
        const retryAttempt = await model.invoke(messages, {
          metadata: { pipeline_stage: 'writer', query: state.query },
          tags: ['multi-agent', 'writer'],
        });
        const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
        response = AgentResponseV2Schema.parse(JSON.parse(cleanLlmOutput(retryContent)));
      }
    } catch {
      messages.push(
        { role: 'assistant', content: firstContent },
        new HumanMessage(
          'Your response was not valid JSON. Respond with valid JSON only, no markdown fencing.',
        ),
      );
      const retryAttempt = await model.invoke(messages, {
        metadata: { pipeline_stage: 'writer', query: state.query },
        tags: ['multi-agent', 'writer'],
      });
      const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
      response = AgentResponseV2Schema.parse(JSON.parse(cleanLlmOutput(retryContent)));
    }

    return { response };
  };
}
