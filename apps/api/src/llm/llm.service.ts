import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmProviderInterface } from './llm-provider.interface';
import { GroqProvider } from './providers/groq.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { MistralProvider } from './providers/mistral.provider';

/** Valid provider name literals. */
type ProviderName = 'groq' | 'claude' | 'mistral';

/** Provider constructor signature for the factory map. */
type ProviderFactory = (config: ConfigService) => LlmProviderInterface;

/** Registry mapping provider names to their factory functions. */
const PROVIDER_FACTORIES: Record<ProviderName, ProviderFactory> = {
  groq: (cfg) => new GroqProvider(cfg),
  claude: (cfg) => new ClaudeProvider(cfg),
  mistral: (cfg) => new MistralProvider(cfg),
};

/**
 * Facade service that resolves the active LLM provider based on the
 * `LLM_PROVIDER` environment variable and exposes its LangChain ChatModel.
 *
 * Other modules should inject `LlmService` rather than working with
 * individual providers directly.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly activeProvider: ProviderName;
  private readonly providers = new Map<string, LlmProviderInterface>();

  constructor(private readonly config: ConfigService) {
    const providerName = this.config.get<string>('LLM_PROVIDER', 'groq');

    if (!this.isValidProvider(providerName)) {
      throw new Error(
        `Unknown LLM provider "${providerName}". Valid values: ${Object.keys(
          PROVIDER_FACTORIES,
        ).join(', ')}`,
      );
    }

    this.activeProvider = providerName;
    this.logger.log(`Active LLM provider: ${this.activeProvider}`);
  }

  /**
   * Return the LangChain ChatModel for the active provider,
   * or for an explicit override.
   *
   * @param providerOverride - Optional provider name to use instead of the default
   * @returns The LangChain BaseChatModel instance
   * @throws Error if the provider name is unknown or the required API key is missing
   */
  getModel(providerOverride?: string): BaseChatModel {
    const name = providerOverride ?? this.activeProvider;
    return this.resolveProvider(name).getModel();
  }

  /**
   * Return the context-window token budget for the active provider,
   * or for an explicit override.
   *
   * @param providerOverride - Optional provider name to use instead of the default
   * @returns Maximum context tokens for the resolved provider
   * @throws Error if the provider name is unknown
   */
  getMaxContextTokens(providerOverride?: string): number {
    const name = providerOverride ?? this.activeProvider;
    return this.resolveProvider(name).maxContextTokens;
  }

  /**
   * Return the name of the currently active LLM provider.
   *
   * @returns The active provider identifier (e.g. "groq", "claude", "mistral")
   */
  getProviderName(): string {
    return this.activeProvider;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a provider by name, lazily instantiating it on first access.
   * Throws a clear error for unknown provider names.
   */
  private resolveProvider(name: string): LlmProviderInterface {
    if (!this.isValidProvider(name)) {
      throw new Error(
        `Unknown LLM provider "${name}". Valid values: ${Object.keys(PROVIDER_FACTORIES).join(
          ', ',
        )}`,
      );
    }

    let provider = this.providers.get(name);
    if (!provider) {
      provider = PROVIDER_FACTORIES[name](this.config);
      this.providers.set(name, provider);
    }
    return provider;
  }

  /** Type-guard that narrows an arbitrary string to a valid ProviderName. */
  private isValidProvider(name: string): name is ProviderName {
    return name in PROVIDER_FACTORIES;
  }
}
