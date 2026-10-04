import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatMistralAI } from '@langchain/mistralai';
import { AsyncCaller } from '@langchain/core/utils/async_caller';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  modelCacheKey,
  type LlmProviderInterface,
  type ModelOptions,
} from '../llm-provider.interface';
import { MISTRAL_MODEL_ID } from '../model-ids';
import { failFastOnClientError } from '../llm-errors';

/** Mistral context window size in tokens. */
const MAX_CONTEXT_TOKENS = 262_000;

/** Same retry budget LangChain's AsyncCaller uses by default. */
const MAX_RETRIES = 6;

/** Mistral JSON mode: the reply is guaranteed to be a valid JSON object. */
export const JSON_OBJECT_FORMAT = { type: 'json_object' } as const;

type MistralCallOptions = Parameters<ChatMistralAI['invocationParams']>[0];

/**
 * Call options with JSON mode applied, unless the call already chose a
 * `response_format`. ChatMistralAI only reads `response_format` from call options
 * (there is no constructor field), so the provider injects it per call.
 */
export function withJsonMode(options: MistralCallOptions): MistralCallOptions {
  if (options?.response_format) return options;
  return { ...(options ?? {}), response_format: JSON_OBJECT_FORMAT } as MistralCallOptions;
}

/**
 * ChatMistralAI whose retries stop on auth/client errors.
 *
 * Upstream `completionWithRetry` retries every error except 400: the Mistral SDK
 * reports the HTTP code as `statusCode`, which LangChain's AsyncCaller doesn't
 * read, so a rejected API key was retried with exponential backoff for ~2 minutes
 * before the user saw an error. We disable the inner retries and run our own
 * loop around the call with {@link failFastOnClientError}.
 */
class FailFastChatMistralAI extends ChatMistralAI {
  private readonly retryCaller = new AsyncCaller({
    maxRetries: MAX_RETRIES,
    onFailedAttempt: failFastOnClientError,
  });

  constructor(
    fields: ConstructorParameters<typeof ChatMistralAI>[0],
    private readonly jsonMode = false,
  ) {
    super({ ...fields, maxRetries: 0 });
  }

  /** Request JSON mode on every call when this instance was created with `json: true`. */
  override invocationParams(options: MistralCallOptions) {
    return super.invocationParams(this.jsonMode ? withJsonMode(options) : options);
  }

  // Upstream's overloads use Mistral SDK request types this app doesn't depend on
  // directly; arguments are passed through unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override completionWithRetry(input: any, streaming: any): Promise<any> {
    return this.retryCaller.call(() => super.completionWithRetry(input, streaming));
  }
}

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
  private readonly models = new Map<string, BaseChatModel>();

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('MISTRAL_API_KEY');
    if (!key) {
      throw new Error('MISTRAL_API_KEY is required when using the Mistral provider');
    }
    this.apiKey = key;
  }

  /** Return (or lazily create) the ChatMistralAI instance. */
  getModel(options: ModelOptions = {}): BaseChatModel {
    const key = modelCacheKey(options);
    let model = this.models.get(key);
    if (!model) {
      model = new FailFastChatMistralAI(
        {
          apiKey: this.apiKey,
          model: MISTRAL_MODEL_ID,
          ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
        },
        options.json ?? false,
      );
      this.models.set(key, model);
    }
    return model;
  }
}
