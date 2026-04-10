/**
 * Clean raw LLM output for JSON parsing.
 *
 * Handles common LLM output patterns that break JSON.parse():
 * - Markdown code fences (```json ... ```)
 * - Qwen3/DeepSeek thinking tags (<think>...</think>)
 * - Leading/trailing whitespace
 */
export function cleanLlmOutput(raw: string): string {
  let cleaned = raw;

  // Strip <think>...</think> blocks (Qwen3, DeepSeek reasoning)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');

  return cleaned.trim();
}
