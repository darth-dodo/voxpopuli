import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AnalysisResultSchema,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';
import { SYNTHESIZER_SYSTEM_PROMPT } from '../prompts/synthesizer.prompt';
import { cleanLlmOutput } from './parse-llm-json';

/**
 * Creates the Synthesizer node function for the pipeline.
 * Single-pass: EvidenceBundle -> AnalysisResult with one retry on parse failure.
 */
export function createSynthesizerNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
  }): Promise<{ analysis: AnalysisResult }> => {
    const messages: Array<SystemMessage | HumanMessage | { role: string; content: string }> = [
      new SystemMessage(SYNTHESIZER_SYSTEM_PROMPT),
      new HumanMessage(JSON.stringify(state.bundle)),
    ];

    // First attempt
    const firstAttempt = await model.invoke(messages);
    const firstContent = typeof firstAttempt.content === 'string' ? firstAttempt.content : '';

    let analysis: AnalysisResult;

    try {
      const parsed = JSON.parse(cleanLlmOutput(firstContent));
      const result = AnalysisResultSchema.safeParse(parsed);
      if (result.success) {
        analysis = result.data;
      } else {
        // Retry with error details
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
        const retryAttempt = await model.invoke(messages);
        const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
        analysis = AnalysisResultSchema.parse(JSON.parse(cleanLlmOutput(retryContent)));
      }
    } catch {
      // JSON parse failed — retry
      messages.push(
        { role: 'assistant', content: firstContent },
        new HumanMessage(
          'Your response was not valid JSON. Respond with valid JSON only, no markdown fencing.',
        ),
      );
      const retryAttempt = await model.invoke(messages);
      const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
      analysis = AnalysisResultSchema.parse(JSON.parse(cleanLlmOutput(retryContent)));
    }

    return { analysis };
  };
}
