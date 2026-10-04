import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/** Per-call-site model tuning. */
export interface ModelOptions {
  /**
   * Hard cap on generated tokens. Output tokens dominate latency (~5s per 1k),
   * so call sites whose useful output is small should bound it.
   */
  maxTokens?: number;
  /**
   * Ask the provider for its JSON mode, so the reply is a syntactically valid JSON
   * object (Mistral and OpenAI-compatible `response_format: { type: 'json_object' }`).
   * The prompt must still describe the shape; callers keep their lenient parsing as a
   * fallback. Providers without a schema-free JSON mode (Claude) ignore the flag.
   */
  json?: boolean;
}

/** Cache key for a provider's per-options model instances. */
export function modelCacheKey(options: ModelOptions = {}): string {
  return `${options.maxTokens ?? ''}|${options.json ? 'json' : ''}`;
}

/**
 * Contract that every LLM provider must implement.
 *
 * Each provider wraps a specific LangChain ChatModel and exposes
 * its context-window budget so the chunker can size prompts correctly.
 */
export interface LlmProviderInterface {
  /** Provider identifier, e.g. "openrouter", "claude", "mistral". */
  readonly name: string;

  /** Total context window size in tokens for this provider's model. */
  readonly maxContextTokens: number;

  /** Return the LangChain ChatModel instance for this provider (cached per options). */
  getModel(options?: ModelOptions): BaseChatModel;
}
