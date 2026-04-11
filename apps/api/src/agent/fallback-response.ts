import type { AgentResponse, AnalysisResult, EvidenceBundle } from '@voxpopuli/shared-types';

/**
 * Build a minimal AgentResponse from AnalysisResult + EvidenceBundle
 * when the Writer fails after retry.
 */
export function buildFallbackResponse(
  _analysis: AnalysisResult,
  _bundle: EvidenceBundle,
  _meta: {
    provider: string;
    durationMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  },
): AgentResponse {
  throw new Error('Not implemented');
}
