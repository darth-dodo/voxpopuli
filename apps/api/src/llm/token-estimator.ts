/** Estimate how many tokens a text string costs for some model. */
export type TokenEstimator = (text: string) => number;

/**
 * Default characters-per-token ratio for providers that have not been calibrated.
 *
 * Roughly 4 characters per token holds for English prose on BPE tokenizers
 * (OpenAI, Anthropic, Mistral). Code, URLs and non-English text tokenize less
 * efficiently, so real counts run higher.
 *
 * Calibration: compare a provider's `estimateTokens()` output against the
 * `usage_metadata` token counts it reports for the same text (the Retriever
 * logs the evidence bundle estimate next to the compaction call's reported
 * output tokens at debug level), then set that provider's `charsPerToken` to
 * the observed ratio.
 */
export const DEFAULT_CHARS_PER_TOKEN = 4;

/**
 * Character-ratio token estimate shared by all providers.
 *
 * @param text - Text to estimate (empty, null or undefined counts as 0)
 * @param charsPerToken - Average characters per token for the target tokenizer
 * @returns Estimated token count, rounded up
 */
export function estimateTokensByChars(text: string, charsPerToken: number): number {
  if (!text) return 0;
  return Math.ceil(text.length / charsPerToken);
}
