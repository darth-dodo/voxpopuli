import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';
import { ChatOpenAI } from '@langchain/openai';
import { OpenRouterProvider, OPENROUTER_BASE_URL } from './providers/openrouter.provider';
import { OPENROUTER_MODEL_ID } from './model-ids';
import { ClaudeProvider } from './providers/claude.provider';
import { MistralProvider } from './providers/mistral.provider';
import type { LlmProviderInterface } from './llm-provider.interface';

// ---------------------------------------------------------------------------
// Mocks — prevent real SDK instantiation
// ---------------------------------------------------------------------------

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    _llmType: () => 'openai',
    invoke: jest.fn(),
  })),
}));

jest.mock('@langchain/anthropic', () => ({
  ChatAnthropic: jest.fn().mockImplementation(() => ({
    _llmType: () => 'anthropic',
    invoke: jest.fn(),
  })),
}));

jest.mock('@langchain/mistralai', () => ({
  ChatMistralAI: jest.fn().mockImplementation(() => ({
    _llmType: () => 'mistralai',
    invoke: jest.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock ConfigService that returns values from the given map. */
function mockConfigService(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key in values && values[key] !== undefined) {
        return values[key];
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

// ---------------------------------------------------------------------------
// Provider Tests
// ---------------------------------------------------------------------------

describe('OpenRouterProvider', () => {
  beforeEach(() => jest.mocked(ChatOpenAI).mockClear());

  it('implements LlmProviderInterface with correct properties', () => {
    const config = mockConfigService({ OPENROUTER_API_KEY: 'test-key' });
    const provider: LlmProviderInterface = new OpenRouterProvider(config);

    expect(provider.name).toBe('openrouter');
    expect(provider.maxContextTokens).toBe(131_000);
  });

  it('getModel() returns a ChatOpenAI instance pointed at OpenRouter', () => {
    const config = mockConfigService({ OPENROUTER_API_KEY: 'test-key' });
    const provider = new OpenRouterProvider(config);
    const model = provider.getModel();

    expect(model).toBeDefined();
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        model: OPENROUTER_MODEL_ID,
        configuration: expect.objectContaining({ baseURL: OPENROUTER_BASE_URL }),
      }),
    );
  });

  it('accepts a custom model slug, name and context budget', () => {
    const config = mockConfigService({ OPENROUTER_API_KEY: 'test-key' });
    const provider = new OpenRouterProvider(config, {
      name: 'openrouter-claude',
      model: 'anthropic/claude-haiku-4.5',
      maxContextTokens: 200_000,
    });
    provider.getModel();

    expect(provider.name).toBe('openrouter-claude');
    expect(provider.maxContextTokens).toBe(200_000);
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-haiku-4.5' }),
    );
  });

  it('getModel() returns the same instance on subsequent calls', () => {
    const config = mockConfigService({ OPENROUTER_API_KEY: 'test-key' });
    const provider = new OpenRouterProvider(config);

    const first = provider.getModel();
    const second = provider.getModel();

    expect(first).toBe(second);
  });

  it('throws when OPENROUTER_API_KEY is missing', () => {
    const config = mockConfigService({});

    expect(() => new OpenRouterProvider(config)).toThrow(
      'OPENROUTER_API_KEY is required when using the OpenRouter provider',
    );
  });
});

describe('ClaudeProvider', () => {
  it('implements LlmProviderInterface with correct properties', () => {
    const config = mockConfigService({ ANTHROPIC_API_KEY: 'test-key' });
    const provider: LlmProviderInterface = new ClaudeProvider(config);

    expect(provider.name).toBe('claude');
    expect(provider.maxContextTokens).toBe(200_000);
  });

  it('getModel() returns a ChatAnthropic instance', () => {
    const config = mockConfigService({ ANTHROPIC_API_KEY: 'test-key' });
    const provider = new ClaudeProvider(config);
    const model = provider.getModel();

    expect(model).toBeDefined();
    expect((model as Record<string, unknown>)['_llmType']).toBeDefined();
  });

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    const config = mockConfigService({});

    expect(() => new ClaudeProvider(config)).toThrow(
      'ANTHROPIC_API_KEY is required when using the Claude provider',
    );
  });
});

describe('MistralProvider', () => {
  it('implements LlmProviderInterface with correct properties', () => {
    const config = mockConfigService({ MISTRAL_API_KEY: 'test-key' });
    const provider: LlmProviderInterface = new MistralProvider(config);

    expect(provider.name).toBe('mistral');
    expect(provider.maxContextTokens).toBe(262_000);
  });

  it('getModel() returns a ChatMistralAI instance', () => {
    const config = mockConfigService({ MISTRAL_API_KEY: 'test-key' });
    const provider = new MistralProvider(config);
    const model = provider.getModel();

    expect(model).toBeDefined();
    expect((model as Record<string, unknown>)['_llmType']).toBeDefined();
  });

  it('throws when MISTRAL_API_KEY is missing', () => {
    const config = mockConfigService({});

    expect(() => new MistralProvider(config)).toThrow(
      'MISTRAL_API_KEY is required when using the Mistral provider',
    );
  });
});

// ---------------------------------------------------------------------------
// LlmService Tests
// ---------------------------------------------------------------------------

describe('LlmService', () => {
  /** All API keys present — the default happy-path config. */
  const allKeysConfig: Record<string, string> = {
    LLM_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'test-openrouter-key',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    MISTRAL_API_KEY: 'test-mistral-key',
  };

  async function buildService(
    envOverrides: Record<string, string | undefined> = {},
  ): Promise<LlmService> {
    const merged = { ...allKeysConfig, ...envOverrides };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: ConfigService,
          useValue: mockConfigService(merged),
        },
      ],
    }).compile();

    return module.get<LlmService>(LlmService);
  }

  // -------------------------------------------------------------------------
  // Active provider resolution
  // -------------------------------------------------------------------------

  it('reads LLM_PROVIDER from env and sets active provider', async () => {
    const service = await buildService({ LLM_PROVIDER: 'claude' });
    expect(service.getProviderName()).toBe('claude');
  });

  it('defaults to mistral when LLM_PROVIDER is not set', async () => {
    const service = await buildService({ LLM_PROVIDER: undefined });
    expect(service.getProviderName()).toBe('mistral');
  });

  // -------------------------------------------------------------------------
  // getModel()
  // -------------------------------------------------------------------------

  it('getModel() returns a model instance for the active provider', async () => {
    const service = await buildService({ LLM_PROVIDER: 'openrouter' });
    const model = service.getModel();

    expect(model).toBeDefined();
  });

  it('getModel() with provider override returns a different instance', async () => {
    const service = await buildService({ LLM_PROVIDER: 'openrouter' });

    const openrouterModel = service.getModel();
    const claudeModel = service.getModel('claude');

    expect(openrouterModel).not.toBe(claudeModel);
  });

  // -------------------------------------------------------------------------
  // getMaxContextTokens()
  // -------------------------------------------------------------------------

  it('getMaxContextTokens() returns correct budget for openrouter', async () => {
    const service = await buildService({ LLM_PROVIDER: 'openrouter' });
    expect(service.getMaxContextTokens()).toBe(131_000);
  });

  it('getMaxContextTokens() returns correct budget for claude', async () => {
    const service = await buildService({ LLM_PROVIDER: 'claude' });
    expect(service.getMaxContextTokens()).toBe(200_000);
  });

  it('getMaxContextTokens() returns correct budget for mistral', async () => {
    const service = await buildService({ LLM_PROVIDER: 'mistral' });
    expect(service.getMaxContextTokens()).toBe(262_000);
  });

  it('getMaxContextTokens() respects provider override', async () => {
    const service = await buildService({ LLM_PROVIDER: 'openrouter' });
    expect(service.getMaxContextTokens('mistral')).toBe(262_000);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('throws for unknown LLM_PROVIDER value', async () => {
    await expect(buildService({ LLM_PROVIDER: 'openai' })).rejects.toThrow(
      'Unknown LLM provider "openai"',
    );
  });

  it('throws for unknown provider override at runtime', async () => {
    const service = await buildService({ LLM_PROVIDER: 'openrouter' });

    expect(() => service.getModel('openai')).toThrow('Unknown LLM provider "openai"');
  });

  it('throws when active provider API key is missing', async () => {
    const service = await buildService({
      LLM_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: undefined,
    });

    // Provider instantiation (and key validation) happens lazily on first access
    expect(() => service.getModel()).toThrow('OPENROUTER_API_KEY is required');
  });

  it('throws when override provider API key is missing', async () => {
    const service = await buildService({
      LLM_PROVIDER: 'openrouter',
      ANTHROPIC_API_KEY: undefined,
    });

    expect(() => service.getModel('claude')).toThrow('ANTHROPIC_API_KEY is required');
  });
});
