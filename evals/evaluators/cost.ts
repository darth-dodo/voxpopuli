import type { EvaluatorResult } from '../types';

interface TokenRates {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PROVIDER_RATES: Record<string, TokenRates> = {
  // OpenRouter qwen/qwen3-235b-a22b-2507 lowest-price host
  openrouter: { inputPerMillion: 0.087, outputPerMillion: 0.35 },
  // claude-haiku-4-5: Anthropic list price (checked 2026-09-28)
  claude: { inputPerMillion: 1.0, outputPerMillion: 5.0 },
  // mistral-small-latest (Mistral Small 4): mistral.ai/pricing/api (checked 2026-09-28)
  mistral: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

/** Maximum acceptable cost per query (from product.md). */
const COST_CEILING = 0.05;

/**
 * Evaluates estimated query cost based on token usage and provider rates.
 *
 * Score = max(0, 1 - estimatedCost / $0.05).
 * Unknown providers default to openrouter rates.
 */
export function evaluateCost(
  totalInputTokens: number,
  totalOutputTokens: number,
  provider: string,
): EvaluatorResult {
  const rates = PROVIDER_RATES[provider] ?? PROVIDER_RATES['openrouter'];

  const estimatedCost =
    (totalInputTokens / 1_000_000) * rates.inputPerMillion +
    (totalOutputTokens / 1_000_000) * rates.outputPerMillion;

  const score = Math.max(0, 1 - estimatedCost / COST_CEILING);

  return {
    key: 'cost',
    score,
    comment: `$${estimatedCost.toFixed(4)} estimated (provider: ${provider})`,
  };
}
