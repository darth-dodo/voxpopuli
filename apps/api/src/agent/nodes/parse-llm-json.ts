/**
 * Clean raw LLM output for JSON parsing.
 *
 * Handles common LLM output patterns that break JSON.parse():
 * - Markdown code fences (```json ... ```)
 * - Thinking tags (<think>...</think>) from Qwen3, DeepSeek, Llama 4
 * - Leading/trailing prose around JSON objects
 * - Leading/trailing whitespace
 */
export function cleanLlmOutput(raw: string): string {
  let cleaned = raw;

  // Strip <think>...</think> blocks (Qwen3, DeepSeek, Llama 4 reasoning)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');

  cleaned = cleaned.trim();

  // Extract the outermost JSON object if surrounded by prose
  if (!cleaned.startsWith('{')) {
    const start = cleaned.indexOf('{');
    if (start !== -1) {
      cleaned = cleaned.slice(start);
    }
  }
  if (!cleaned.endsWith('}')) {
    const end = cleaned.lastIndexOf('}');
    if (end !== -1) {
      cleaned = cleaned.slice(0, end + 1);
    }
  }

  return cleaned.trim();
}
