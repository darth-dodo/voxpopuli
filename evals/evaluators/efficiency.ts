import type { EvaluatorResult } from '../types';

/**
 * Evaluates agent efficiency based on step count vs acceptable maximum.
 *
 * Score = 1.0 if steps <= max, linearly decreasing to 0 at 2x max.
 */
export function evaluateEfficiency(
  stepCount: number,
  maxAcceptableSteps: number,
): EvaluatorResult {
  let score: number;

  if (stepCount <= maxAcceptableSteps) {
    score = 1.0;
  } else {
    score = Math.max(0, 1 - (stepCount - maxAcceptableSteps) / maxAcceptableSteps);
  }

  return {
    key: 'efficiency',
    score,
    comment: `${stepCount} steps (max acceptable: ${maxAcceptableSteps})`,
  };
}
