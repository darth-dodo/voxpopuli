import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AgentResponseV2Schema,
  type AgentResponseV2,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';
import { WRITER_SYSTEM_PROMPT } from '../prompts/writer.prompt';

/** Strip markdown code fences from LLM output. */
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
}

/**
 * Creates the Writer node function for the pipeline.
 * Single-pass: AnalysisResult + EvidenceBundle → AgentResponseV2.
 */
export function createWriterNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
    analysis: AnalysisResult;
    events: unknown[];
  }): Promise<{ response: AgentResponseV2; events: unknown[] }> => {
    const startTime = Date.now();
    const events = [...state.events];

    events.push({
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
      const parsed = JSON.parse(stripFences(firstContent));
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
        response = AgentResponseV2Schema.parse(JSON.parse(stripFences(retryContent)));
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
      response = AgentResponseV2Schema.parse(JSON.parse(stripFences(retryContent)));
    }

    events.push({
      stage: 'writer',
      status: 'done',
      detail: `${response.sections.length} sections, ${response.sources.length} sources cited`,
      elapsed: Date.now() - startTime,
    });

    return { response, events };
  };
}
