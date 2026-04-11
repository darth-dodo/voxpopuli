import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmProviderInterface } from '../llm-provider.interface';

/** Claude model identifier. */
const MODEL_ID = 'claude-haiku-4-5-20251001';

/** Claude context window size in tokens. */
const MAX_CONTEXT_TOKENS = 200_000;

/**
 * LLM provider backed by Anthropic's Claude Haiku 4.5.
 *
 * Reads `ANTHROPIC_API_KEY` from the environment at construction time
 * and throws immediately if the key is missing.
 */
@Injectable()
export class ClaudeProvider implements LlmProviderInterface {
  readonly name = 'claude';
  readonly maxContextTokens = MAX_CONTEXT_TOKENS;

  private readonly apiKey: string;
  private model: BaseChatModel | null = null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY is required when using the Claude provider');
    }
    this.apiKey = key;
  }

  /** Return (or lazily create) the ChatAnthropic instance. */
  getModel(): BaseChatModel {
    if (!this.model) {
      this.model = new ChatAnthropic({
        apiKey: this.apiKey,
        model: MODEL_ID,
      });
    }
    return this.model;
  }
}
