import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatMistralAI } from '@langchain/mistralai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmProviderInterface } from '../llm-provider.interface';

/** Mistral model identifier. */
const MODEL_ID = 'mistral-large-latest';

/** Mistral context window size in tokens. */
const MAX_CONTEXT_TOKENS = 262_000;

/**
 * LLM provider backed by Mistral AI's hosted models.
 *
 * Reads `MISTRAL_API_KEY` from the environment at construction time
 * and throws immediately if the key is missing.
 */
@Injectable()
export class MistralProvider implements LlmProviderInterface {
  readonly name = 'mistral';
  readonly maxContextTokens = MAX_CONTEXT_TOKENS;

  private readonly apiKey: string;
  private model: BaseChatModel | null = null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('MISTRAL_API_KEY');
    if (!key) {
      throw new Error('MISTRAL_API_KEY is required when using the Mistral provider');
    }
    this.apiKey = key;
  }

  /** Return (or lazily create) the ChatMistralAI instance. */
  getModel(): BaseChatModel {
    if (!this.model) {
      this.model = new ChatMistralAI({
        apiKey: this.apiKey,
        model: MODEL_ID,
      });
    }
    return this.model;
  }
}
