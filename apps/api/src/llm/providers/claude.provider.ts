import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  modelCacheKey,
  type LlmProviderInterface,
  type ModelOptions,
} from '../llm-provider.interface';
import { CLAUDE_MODEL_ID } from '../model-ids';

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
  private readonly models = new Map<string, BaseChatModel>();

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY is required when using the Claude provider');
    }
    this.apiKey = key;
  }

  /**
   * Return (or lazily create) the ChatAnthropic instance.
   *
   * `options.json` is ignored: Anthropic has no schema-free JSON mode (only
   * schema-bound structured output), so JSON stages rely on the prompt and the
   * callers' lenient parsing.
   */
  getModel(options: ModelOptions = {}): BaseChatModel {
    const key = modelCacheKey({ maxTokens: options.maxTokens });
    let model = this.models.get(key);
    if (!model) {
      model = new ChatAnthropic({
        apiKey: this.apiKey,
        model: CLAUDE_MODEL_ID,
        ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
      });
      this.models.set(key, model);
    }
    return model;
  }
}
