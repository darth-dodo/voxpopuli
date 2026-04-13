import { AIMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeWithRetry } from '../../llm/invoke-with-retry';
import {
  AnalysisResultSchema,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';
import { SYNTHESIZER_SYSTEM_PROMPT } from '../prompts/synthesizer.prompt';
import { cleanLlmOutput } from './parse-llm-json';

/**
 * Builds a token-efficient, structured text representation of an EvidenceBundle
 * for the Synthesizer LLM. Strips fields the Synthesizer does not need
 * (url, commentCount, tokenCount) and formats as readable text rather than
 * raw JSON, which LLMs handle more efficiently for analysis tasks.
 */
function formatBundleForSynthesizer(bundle: EvidenceBundle): string {
  const lines: string[] = [];

  lines.push(`Query: "${bundle.query}"`);
  lines.push('');

  // Sources section — numbered list with author and points only
  lines.push(`## Sources (${bundle.totalSourcesScanned} stories scanned)`);
  for (const src of bundle.allSources) {
    lines.push(`[${src.storyId}] "${src.title}" by ${src.author} (${src.points} pts)`);
  }
  lines.push('');

  // Themes section — each theme with its evidence items
  lines.push('## Themes');
  for (let i = 0; i < bundle.themes.length; i++) {
    const theme = bundle.themes[i];
    lines.push('');
    lines.push(`### Theme ${i + 1}: ${theme.label}`);
    for (const item of theme.items) {
      lines.push(
        `- [${item.type}] ${item.text} (source ${item.sourceId}, relevance: ${item.relevance})`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Creates the Synthesizer node function for the pipeline.
 * Single-pass: EvidenceBundle -> AnalysisResult with one retry on parse failure.
 */
/** Extract token counts from a LangChain AI message response. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTokens(msg: any): { input: number; output: number } {
  const usage = msg?.usage_metadata;
  return { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 };
}

export function createSynthesizerNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
  }): Promise<{ analysis: AnalysisResult; inputTokens: number; outputTokens: number }> => {
    let inputTokens = 0;
    let outputTokens = 0;

    const messages: BaseMessage[] = [
      new SystemMessage(SYNTHESIZER_SYSTEM_PROMPT),
      new HumanMessage(formatBundleForSynthesizer(state.bundle)),
    ];

    // First attempt
    const firstAttempt = await invokeWithRetry(model, messages, {
      metadata: { pipeline_stage: 'synthesizer', query: state.query },
      tags: ['multi-agent', 'synthesizer'],
    });
    const t1 = extractTokens(firstAttempt);
    inputTokens += t1.input;
    outputTokens += t1.output;
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
          metadata: { pipeline_stage: 'synthesizer', query: state.query },
          tags: ['multi-agent', 'synthesizer'],
        });
        const t2 = extractTokens(retryAttempt);
        inputTokens += t2.input;
        outputTokens += t2.output;
        const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
        analysis = AnalysisResultSchema.parse(JSON.parse(cleanLlmOutput(retryContent)));
      }
    } catch {
      // JSON parse failed — retry
      messages.push(
        new AIMessage(firstContent),
        new HumanMessage(
          'Your response was not valid JSON. Respond with valid JSON only, no markdown fencing.',
        ),
      );
      const retryAttempt = await invokeWithRetry(model, messages, {
        metadata: { pipeline_stage: 'synthesizer', query: state.query },
        tags: ['multi-agent', 'synthesizer'],
      });
      const t2 = extractTokens(retryAttempt);
      inputTokens += t2.input;
      outputTokens += t2.output;
      const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
      analysis = AnalysisResultSchema.parse(JSON.parse(cleanLlmOutput(retryContent)));
    }

    return { analysis, inputTokens, outputTokens };
  };
}
