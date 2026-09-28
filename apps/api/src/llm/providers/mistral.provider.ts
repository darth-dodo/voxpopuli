import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatMistralAI } from '@langchain/mistralai';
import { AsyncCaller } from '@langchain/core/utils/async_caller';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmProviderInterface, ModelOptions } from '../llm-provider.interface';
import { MISTRAL_MODEL_ID } from '../model-ids';
import { failFastOnClientError } from '../llm-errors';

/** Mistral context window size in tokens. */
const MAX_CONTEXT_TOKENS = 262_000;

/** Same retry budget LangChain's AsyncCaller uses by default. */
const MAX_RETRIES = 6;

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

  constructor(fields: ConstructorParameters<typeof ChatMistralAI>[0]) {
    super({ ...fields, maxRetries: 0 });
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
  private readonly models = new Map<number | undefined, BaseChatModel>();

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('MISTRAL_API_KEY');
    if (!key) {
      throw new Error('MISTRAL_API_KEY is required when using the Mistral provider');
    }
    this.apiKey = key;
  }

  /** Return (or lazily create) the ChatMistralAI instance. */
  getModel(options: ModelOptions = {}): BaseChatModel {
    let model = this.models.get(options.maxTokens);
    if (!model) {
      model = new FailFastChatMistralAI({
        apiKey: this.apiKey,
        model: MISTRAL_MODEL_ID,
        ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
      });
      this.models.set(options.maxTokens, model);
    }
    return model;
  }
}
