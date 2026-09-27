import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TtsService, TtsUpstreamError, TTS_CONTENT_TYPE } from './tts.service';
import { LlmService } from '../llm/llm.service';
import { OPENROUTER_BASE_URL, OPENROUTER_TTS_MODEL_ID } from '../llm/model-ids';

// Mock LLM provider modules to avoid ESM resolution issues
jest.mock('../llm/providers/openrouter.provider', () => ({ OpenRouterProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

const PCM_A = Buffer.from([1, 2, 3, 4]);
const PCM_B = Buffer.from([5, 6]);

/**
 * Build an SSE Response like OpenRouter's audio stream. The body is split
 * into small byte chunks so lines straddle chunk boundaries.
 */
function sseResponse(events: unknown[], chunkSize = 7): Response {
  const text =
    ': OPENROUTER PROCESSING\n\n' +
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') +
    'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function audioEvent(pcm: Buffer, transcript = '') {
  return { choices: [{ delta: { audio: { data: pcm.toString('base64'), transcript } } }] };
}

describe('TtsService', () => {
  let service: TtsService;
  let llmService: jest.Mocked<LlmService>;
  let fetchMock: jest.SpyInstance;

  const config: Record<string, string | undefined> = { OPENROUTER_API_KEY: 'test-key' };
  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => config[key] ?? defaultValue),
  };

  const mockLlmService = {
    getModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({
        content:
          "The community is buzzing about AI agents. Developer swyx, with over 340 points, argues they are the future. That's the signal from HN. I'm VoxPopuli.",
      }),
    }),
  };

  async function build(): Promise<void> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TtsService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LlmService, useValue: mockLlmService },
      ],
    }).compile();

    service = module.get<TtsService>(TtsService);
    llmService = module.get(LlmService) as jest.Mocked<LlmService>;
  }

  beforeEach(async () => {
    config['OPENROUTER_API_KEY'] = 'test-key';
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => sseResponse([audioEvent(PCM_A, 'Hello'), audioEvent(PCM_B)]));
    await build();
  });

  afterEach(() => fetchMock.mockRestore());

  describe('rewriteForSpeech', () => {
    it('should call LLM with narrator prompt and return script text', async () => {
      const result = await service.rewriteForSpeech('Some answer text about AI agents');

      expect(llmService.getModel).toHaveBeenCalled();
      expect(result).toContain("I'm VoxPopuli");
    });

    it('should truncate output exceeding 2500 characters', async () => {
      mockLlmService.getModel().invoke.mockResolvedValueOnce({ content: 'A'.repeat(3000) });

      const result = await service.rewriteForSpeech('test');

      expect(result.length).toBeLessThanOrEqual(2500);
    });
  });

  describe('synthesize', () => {
    it('should request streamed pcm16 audio from OpenRouter with the default model and voice', async () => {
      await service.synthesize('Read this');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
      expect(body).toMatchObject({
        model: OPENROUTER_TTS_MODEL_ID,
        stream: true,
        modalities: ['text', 'audio'],
        audio: { voice: 'onyx', format: 'pcm16' },
      });
      expect(body.messages[1]).toEqual({ role: 'user', content: 'Read this' });
    });

    it('should concatenate audio chunks across SSE boundaries into a WAV file', async () => {
      const wav = await service.synthesize('Read this');

      expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
      expect(wav.subarray(44)).toEqual(Buffer.concat([PCM_A, PCM_B]));
    });

    it('should honour a voice override', async () => {
      await service.synthesize('Read this', 'nova');

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.audio.voice).toBe('nova');
    });

    it('should use OPENROUTER_TTS_MODEL and OPENROUTER_TTS_VOICE when set', async () => {
      config['OPENROUTER_TTS_MODEL'] = 'openai/gpt-audio';
      config['OPENROUTER_TTS_VOICE'] = 'shimmer';
      await build();

      await service.synthesize('Read this');

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.model).toBe('openai/gpt-audio');
      expect(body.audio.voice).toBe('shimmer');
      delete config['OPENROUTER_TTS_MODEL'];
      delete config['OPENROUTER_TTS_VOICE'];
    });

    it('should throw TtsUpstreamError with the OpenRouter message on HTTP errors', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'ZDR violation' } }), { status: 404 }),
      );

      await expect(service.synthesize('x')).rejects.toThrow(
        new TtsUpstreamError('OpenRouter TTS request failed (404): ZDR violation'),
      );
    });

    it('should throw TtsUpstreamError on an in-stream error event', async () => {
      fetchMock.mockResolvedValueOnce(sseResponse([{ error: { message: 'boom' } }]));

      await expect(service.synthesize('x')).rejects.toThrow('OpenRouter TTS stream error: boom');
    });

    it('should throw TtsUpstreamError when no audio is returned', async () => {
      fetchMock.mockResolvedValueOnce(sseResponse([{ choices: [{ delta: { content: 'hi' } }] }]));

      await expect(service.synthesize('x')).rejects.toBeInstanceOf(TtsUpstreamError);
    });

    it('should fail fast when OPENROUTER_API_KEY is missing', async () => {
      config['OPENROUTER_API_KEY'] = undefined;
      await build();

      await expect(service.synthesize('x')).rejects.toThrow('OPENROUTER_API_KEY is required');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('narrate', () => {
    it('should return WAV audio, content type, and character count', async () => {
      const result = await service.narrate('Answer text', { rewrite: true });

      expect(result.contentType).toBe(TTS_CONTENT_TYPE);
      expect(result.audio.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(result.characterCount).toBeGreaterThan(0);
    });

    it('should skip rewrite when rewrite is false', async () => {
      const callsBefore = mockLlmService.getModel.mock.calls.length;

      const result = await service.narrate('Raw text for TTS', { rewrite: false });

      expect(mockLlmService.getModel.mock.calls.length).toBe(callsBefore);
      expect(result.characterCount).toBe('Raw text for TTS'.length);
    });
  });
});
