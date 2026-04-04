import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGroq } from '@langchain/groq';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmProviderInterface } from '../llm-provider.interface';

/** Groq model identifier. */
const MODEL_ID = 'llama-3.3-70b-versatile';

/** Groq context window size in tokens. */
const MAX_CONTEXT_TOKENS = 128_000;

/**
 * LLM provider backed by Groq's hosted LLaMA models.
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
        model: MODEL_ID,
      });
    }
    return this.model;
  }
}
