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
export function createSynthesizerNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
  }): Promise<{ analysis: AnalysisResult }> => {
    const messages: Array<SystemMessage | HumanMessage | { role: string; content: string }> = [
      new SystemMessage(SYNTHESIZER_SYSTEM_PROMPT),
      new HumanMessage(formatBundleForSynthesizer(state.bundle)),
    ];

    // First attempt
    const firstAttempt = await model.invoke(messages, {
      metadata: { pipeline_stage: 'synthesizer', query: state.query },
      tags: ['multi-agent', 'synthesizer'],
    });
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
        const retryAttempt = await model.invoke(messages, {
          metadata: { pipeline_stage: 'synthesizer', query: state.query },
          tags: ['multi-agent', 'synthesizer'],
        });
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
      const retryAttempt = await model.invoke(messages, {
        metadata: { pipeline_stage: 'synthesizer', query: state.query },
        tags: ['multi-agent', 'synthesizer'],
      });
      const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
      analysis = AnalysisResultSchema.parse(JSON.parse(cleanLlmOutput(retryContent)));
    }

    return { analysis };
  };
}
