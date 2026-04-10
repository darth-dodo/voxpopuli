import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AgentResponseV2Schema,
  type AgentResponseV2,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';
import { WRITER_SYSTEM_PROMPT } from '../prompts/writer.prompt';
import { cleanLlmOutput } from './parse-llm-json';

/**
 * Creates the Writer node function for the pipeline.
 * Single-pass: AnalysisResult + EvidenceBundle → AgentResponseV2.
 */
export function createWriterNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
    analysis: AnalysisResult;
  }): Promise<{ response: AgentResponseV2 }> => {
    const startTime = Date.now();

    await dispatchCustomEvent('pipeline_event', {
      stage: 'writer',
      status: 'started',
      detail: 'Composing headline and sections...',
      elapsed: Date.now() - startTime,
    });

    const input = JSON.stringify({
      analysis: state.analysis,
      bundle: state.bundle,
    });

    const messages: Array<SystemMessage | HumanMessage | { role: string; content: string }> = [
      new SystemMessage(WRITER_SYSTEM_PROMPT),
      new HumanMessage(input),
    ];

    // First attempt
    const firstAttempt = await model.invoke(messages);
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
        const retryAttempt = await model.invoke(messages);
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
      const retryAttempt = await model.invoke(messages);
      const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
      response = AgentResponseV2Schema.parse(JSON.parse(cleanLlmOutput(retryContent)));
    }

    await dispatchCustomEvent('pipeline_event', {
      stage: 'writer',
      status: 'done',
      detail: `${response.sections.length} sections, ${response.sources.length} sources cited`,
      elapsed: Date.now() - startTime,
    });

    return { response };
  };
}
