import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TtsService, TtsUpstreamError, TTS_CONTENT_TYPE } from './tts.service';
import { LlmService } from '../llm/llm.service';
import { MISTRAL_API_BASE_URL, MISTRAL_TTS_MODEL_ID } from '../llm/model-ids';

// Mock LLM provider modules to avoid ESM resolution issues
jest.mock('../llm/providers/openrouter.provider', () => ({ OpenRouterProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

const MP3 = Buffer.from('ID3fake-mp3-bytes');

/** Build a Mistral `/audio/speech` JSON response. */
function speechResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('TtsService', () => {
  let service: TtsService;
  let llmService: jest.Mocked<LlmService>;
  let fetchMock: jest.SpyInstance;

  const config: Record<string, string | undefined> = { MISTRAL_API_KEY: 'test-key' };
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
    config['MISTRAL_API_KEY'] = 'test-key';
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => speechResponse({ audio_data: MP3.toString('base64') }));
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
    it('should request mp3 speech from Voxtral with the default model and voice', async () => {
      await service.synthesize('Read this');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${MISTRAL_API_BASE_URL}/audio/speech`);
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
      expect(JSON.parse(init.body as string)).toEqual({
        model: MISTRAL_TTS_MODEL_ID,
        input: 'Read this',
        voice_id: 'en_paul_neutral',
        response_format: 'mp3',
      });
    });

    it('should decode base64 audio_data into an MP3 buffer', async () => {
      const audio = await service.synthesize('Read this');

      expect(audio).toEqual(MP3);
    });

    it('should add a Xing header to VBR MP3 so mobile browsers get the exact duration', async () => {
      // Two MPEG-2 Layer III, 22.05 kHz, mono frames at different bitrates, no Xing header
      const vbr = Buffer.concat([
        Object.assign(Buffer.alloc(130), { 0: 0xff, 1: 0xf3, 2: 0x50, 3: 0xc0 }), // 40 kbps
        Object.assign(Buffer.alloc(261), { 0: 0xff, 1: 0xf3, 2: 0x90, 3: 0xc0 }), // 80 kbps
      ]);
      fetchMock.mockResolvedValueOnce(speechResponse({ audio_data: vbr.toString('base64') }));

      const audio = await service.synthesize('Read this');

      const tagAt = audio.indexOf('Xing');
      expect(tagAt).toBeGreaterThan(0);
      expect(audio.readUInt32BE(tagAt + 8)).toBe(2); // exact frame count
      expect(audio.subarray(audio.length - vbr.length)).toEqual(vbr);
    });

    it('should honour a voice override', async () => {
      await service.synthesize('Read this', 'gb_jane_neutral');

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.voice_id).toBe('gb_jane_neutral');
    });

    it('should use MISTRAL_TTS_MODEL and MISTRAL_TTS_VOICE when set', async () => {
      config['MISTRAL_TTS_MODEL'] = 'voxtral-mini-tts-2603';
      config['MISTRAL_TTS_VOICE'] = 'gb_oliver_neutral';
      await build();

      await service.synthesize('Read this');

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.model).toBe('voxtral-mini-tts-2603');
      expect(body.voice_id).toBe('gb_oliver_neutral');
      delete config['MISTRAL_TTS_MODEL'];
      delete config['MISTRAL_TTS_VOICE'];
    });

    it('should throw TtsUpstreamError with the Mistral message on HTTP errors', async () => {
      fetchMock.mockResolvedValueOnce(speechResponse({ message: 'Voice not found' }, 404));

      await expect(service.synthesize('x')).rejects.toThrow(
        new TtsUpstreamError('Mistral TTS request failed (404): Voice not found'),
      );
    });

    it('should report validation details on 422 errors', async () => {
      fetchMock.mockResolvedValueOnce(speechResponse({ detail: [{ msg: 'input too long' }] }, 422));

      await expect(service.synthesize('x')).rejects.toThrow('input too long');
    });

    it('should handle non-JSON error bodies', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

      await expect(service.synthesize('x')).rejects.toThrow(
        'Mistral TTS request failed (502): Bad Gateway',
      );
    });

    it('should throw TtsUpstreamError when no audio is returned', async () => {
      fetchMock.mockResolvedValueOnce(speechResponse({}));

      await expect(service.synthesize('x')).rejects.toBeInstanceOf(TtsUpstreamError);
    });

    it('should fail fast when MISTRAL_API_KEY is missing', async () => {
      config['MISTRAL_API_KEY'] = undefined;
      await build();

      await expect(service.synthesize('x')).rejects.toThrow('MISTRAL_API_KEY is required');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('narrate', () => {
    it('should return MP3 audio, content type, and character count', async () => {
      const result = await service.narrate('Answer text', { rewrite: true });

      expect(result.contentType).toBe(TTS_CONTENT_TYPE);
      expect(result.contentType).toBe('audio/mpeg');
      expect(result.audio).toEqual(MP3);
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
