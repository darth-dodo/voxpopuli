import type {
  AgentResponse,
  AgentStep,
  AnalysisResult,
  EvidenceBundle,
} from '@voxpopuli/shared-types';
import { computeTrustMetadata } from './trust';

/**
 * Build a minimal AgentResponse from AnalysisResult + EvidenceBundle
 * when the Writer stage fails after retry.
 *
 * Mapping:
 * - headline = analysis.summary
 * - sections = one per insight (claim → heading, reasoning → body)
 * - bottomLine = confidence + gaps
 * - sources = bundle.allSources
 */
export function buildFallbackResponse(
  analysis: AnalysisResult,
  bundle: EvidenceBundle,
  meta: {
    provider: string;
    durationMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  },
  steps: AgentStep[] = [],
): AgentResponse {
  const sections = analysis.insights
    .map((insight) => `### ${insight.claim}\n\n${insight.reasoning}`)
    .join('\n\n');

  const gapsList = analysis.gaps.length > 0 ? ` Gaps: ${analysis.gaps.join('; ')}.` : '';
  const bottomLine = `Confidence: ${analysis.confidence}.${gapsList}`;

  const answer = `## ${analysis.summary}\n\n${sections}\n\n**Bottom line:** ${bottomLine}`;

  const sources = bundle.allSources.map((s) => ({
    storyId: s.storyId,
    title: s.title,
    url: s.url,
    author: s.author,
    points: s.points,
    commentCount: s.commentCount,
  }));

  return {
    answer,
    steps: [],
    sources,
    meta: {
      ...meta,
      cached: false,
      error: true,
    },
    trust: computeTrustMetadata(steps, sources, answer),
  };
}
