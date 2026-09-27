import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmProviderInterface } from './llm-provider.interface';
import { OpenRouterProvider } from './providers/openrouter.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { MistralProvider } from './providers/mistral.provider';

/** Valid provider name literals. */
type ProviderName = 'openrouter' | 'claude' | 'mistral';

/** Provider constructor signature for the factory map. */
type ProviderFactory = (config: ConfigService) => LlmProviderInterface;

/** Registry mapping provider names to their factory functions. */
const PROVIDER_FACTORIES: Record<ProviderName, ProviderFactory> = {
  openrouter: (cfg) => new OpenRouterProvider(cfg),
  claude: (cfg) => new ClaudeProvider(cfg),
  mistral: (cfg) => new MistralProvider(cfg),
};

/**
 * Deprecated provider names mapped to their replacements. Keeps deployments
 * with a stale `LLM_PROVIDER` (e.g. a shared Render env group) and cached
 * frontends that still send `provider=groq` working after a rename.
 */
const PROVIDER_ALIASES: Record<string, ProviderName> = {
  groq: 'openrouter',
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
    const providerName = this.normalizeProviderName(
      this.config.get<string>('LLM_PROVIDER', 'mistral'),
    );

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
    const name = providerOverride
      ? this.normalizeProviderName(providerOverride)
      : this.activeProvider;
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
    const name = providerOverride
      ? this.normalizeProviderName(providerOverride)
      : this.activeProvider;
    return this.resolveProvider(name).maxContextTokens;
  }

  /**
   * Return the name of the currently active LLM provider.
   *
   * @returns The active provider identifier (e.g. "openrouter", "claude", "mistral")
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

  /**
   * Map a deprecated provider name to its replacement, logging a warning.
   * Unknown names pass through unchanged so validation can reject them.
   */
  private normalizeProviderName(name: string): string {
    const replacement = PROVIDER_ALIASES[name];
    if (!replacement) return name;
    this.logger.warn(
      `LLM provider "${name}" is deprecated; using "${replacement}". Update LLM_PROVIDER / provider params.`,
    );
    return replacement;
  }

  /** Type-guard that narrows an arbitrary string to a valid ProviderName. */
  private isValidProvider(name: string): name is ProviderName {
    return name in PROVIDER_FACTORIES;
  }
}
