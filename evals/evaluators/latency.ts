import type { EvaluatorResult } from '../types';

interface LatencyThreshold {
  maxMs: number;
  score: number;
}

const PROVIDER_THRESHOLDS: Record<string, LatencyThreshold[]> = {
  groq: [
    { maxMs: 15_000, score: 1.0 },
    { maxMs: 30_000, score: 0.7 },
    { maxMs: 60_000, score: 0.3 },
  ],
  claude: [
    { maxMs: 30_000, score: 1.0 },
    { maxMs: 60_000, score: 0.6 },
    { maxMs: 120_000, score: 0.3 },
  ],
  mistral: [
    { maxMs: 30_000, score: 1.0 },
    { maxMs: 60_000, score: 0.6 },
    { maxMs: 90_000, score: 0.3 },
  ],
};

const DEFAULT_THRESHOLDS: LatencyThreshold[] = [
  { maxMs: 13_000, score: 1.0 },
  { maxMs: 30_000, score: 0.5 },
];

/**
 * Evaluates response latency with provider-specific thresholds.
 *
 * Each provider has different acceptable latency bands reflecting
 * their expected response characteristics.
 */
export function evaluateLatency(durationMs: number, provider: string): EvaluatorResult {
  const thresholds = PROVIDER_THRESHOLDS[provider] ?? DEFAULT_THRESHOLDS;
  let score = 0.0;

  for (const threshold of thresholds) {
    if (durationMs < threshold.maxMs) {
      score = threshold.score;
      break;
    }
  }

  const durationSec = (durationMs / 1000).toFixed(1);

  return {
    key: 'latency',
    score,
    comment: `${durationSec}s (provider: ${provider})`,
  };
}
