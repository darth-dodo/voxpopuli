import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGroq } from '@langchain/groq';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmProviderInterface } from '../llm-provider.interface';
import { GROQ_MODEL_ID } from '../model-ids';

/** Groq context window size in tokens. */
const MAX_CONTEXT_TOKENS = 131_000;

/**
 * LLM provider backed by Groq's hosted models (Qwen3 32B).
 *
 * Reads `GROQ_API_KEY` from the environment at construction time
 * and throws immediately if the key is missing.
 */
@Injectable()
export class GroqProvider implements LlmProviderInterface {
  readonly name = 'groq';
  readonly maxContextTokens = MAX_CONTEXT_TOKENS;

  private readonly apiKey: string;
  private model: BaseChatModel | null = null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('GROQ_API_KEY');
    if (!key) {
      throw new Error('GROQ_API_KEY is required when using the Groq provider');
    }
    this.apiKey = key;
  }

  /** Return (or lazily create) the ChatGroq instance. */
  getModel(): BaseChatModel {
    if (!this.model) {
      this.model = new ChatGroq({
        apiKey: this.apiKey,
        model: GROQ_MODEL_ID,
      });
    }
    return this.model;
  }
}
