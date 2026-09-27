import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmProviderInterface } from '../llm-provider.interface';
import { OPENROUTER_MODEL_ID } from '../model-ids';

/** OpenRouter's OpenAI-compatible API endpoint. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Context window for the default model (Qwen3 235B A22B 2507). The model supports
 * 262k, but some OpenRouter hosts cap it at 128k, so budget for the smallest.
 */
const MAX_CONTEXT_TOKENS = 128_000;

/**
 * Completion cap sent as `max_tokens`. Without it some OpenRouter hosts default
 * the completion to the full context window, so input + completion overflows
 * and the request fails with a 400.
 */
export const OPENROUTER_MAX_OUTPUT_TOKENS = 8_192;

/**
 * OpenRouter provider-routing preferences. Prefer the highest-throughput host:
 * hosts for the same model differ by 10x in speed, which matters for the
 * multi-call agent pipeline. See https://openrouter.ai/docs/features/provider-routing
 */
export const OPENROUTER_ROUTING = { sort: 'throughput' } as const;

/**
 * LLM provider backed by OpenRouter's OpenAI-compatible gateway.
 *
 * OpenRouter fronts many upstream vendors behind one API key, so the
 * model is just a slug (e.g. `qwen/qwen3-235b-a22b-2507`). Additional OpenRouter-backed
 * models can reuse this class by passing a different `model`/`name`.
 *
 * Reads `OPENROUTER_API_KEY` from the environment at construction time
 * and throws immediately if the key is missing. The model slug can be
 * overridden with `OPENROUTER_MODEL` (defaults to `OPENROUTER_MODEL_ID`).
 */
@Injectable()
export class OpenRouterProvider implements LlmProviderInterface {
  readonly name: string;
  readonly maxContextTokens: number;

  private readonly apiKey: string;
  private readonly modelId: string;
  private model: BaseChatModel | null = null;

  constructor(
    private readonly config: ConfigService,
    options: { name?: string; model?: string; maxContextTokens?: number } = {},
  ) {
    const key = this.config.get<string>('OPENROUTER_API_KEY');
    if (!key) {
      throw new Error('OPENROUTER_API_KEY is required when using the OpenRouter provider');
    }
    this.apiKey = key;
    this.name = options.name ?? 'openrouter';
    this.modelId =
      options.model ?? this.config.get<string>('OPENROUTER_MODEL') ?? OPENROUTER_MODEL_ID;
    this.maxContextTokens = options.maxContextTokens ?? MAX_CONTEXT_TOKENS;
  }

  /** Return (or lazily create) the ChatOpenAI instance pointed at OpenRouter. */
  getModel(): BaseChatModel {
    if (!this.model) {
      this.model = new ChatOpenAI({
        apiKey: this.apiKey,
        model: this.modelId,
        maxTokens: OPENROUTER_MAX_OUTPUT_TOKENS,
        modelKwargs: { provider: OPENROUTER_ROUTING },
        configuration: {
          baseURL: OPENROUTER_BASE_URL,
          // Optional OpenRouter app attribution header (shows up in their dashboard).
          defaultHeaders: { 'X-Title': 'VoxPopuli' },
        },
      });
    }
    return this.model;
  }
}
