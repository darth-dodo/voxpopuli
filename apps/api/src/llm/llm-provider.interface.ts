import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Contract that every LLM provider must implement.
 *
 * Each provider wraps a specific LangChain ChatModel and exposes
 * its context-window budget so the chunker can size prompts correctly.
 */
export interface LlmProviderInterface {
  /** Provider identifier, e.g. "groq", "claude", "mistral". */
  readonly name: string;

  /** Total context window size in tokens for this provider's model. */
  readonly maxContextTokens: number;

  /** Return the LangChain ChatModel instance for this provider. */
  getModel(): BaseChatModel;
}
