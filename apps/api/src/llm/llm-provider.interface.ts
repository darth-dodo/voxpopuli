import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/** Per-call-site model tuning. */
export interface ModelOptions {
  /**
   * Hard cap on generated tokens. Output tokens dominate latency (~5s per 1k),
   * so call sites whose useful output is small should bound it.
   */
  maxTokens?: number;
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
