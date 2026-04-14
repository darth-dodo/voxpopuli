import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TtsService } from './tts.service';
import { LlmService } from '../llm/llm.service';
import { Readable } from 'node:stream';

// Mock LLM provider modules to avoid ESM resolution issues
jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

// Mock the elevenlabs SDK — use mockImplementation so each call creates a fresh stream
jest.mock('elevenlabs', () => ({
  ElevenLabsClient: jest.fn().mockImplementation(() => ({
    textToSpeech: {
      convertAsStream: jest
        .fn()
        .mockImplementation(() => Promise.resolve(Readable.from([Buffer.from('fake-mp3-data')]))),
    },
  })),
}));

describe('TtsService', () => {
  let service: TtsService;
  let llmService: jest.Mocked<LlmService>;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        ELEVENLABS_API_KEY: 'test-api-key',
        ELEVENLABS_VOICE_ID: 'nPczCjzI2devNBz1zQrb',
        ELEVENLABS_MODEL: 'eleven_multilingual_v2',
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockLlmService = {
    getModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({
        content:
          "The community is buzzing about AI agents. Developer swyx, with over 340 points, argues they are the future. That's the signal from HN. I'm VoxPopuli.",
      }),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TtsService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LlmService, useValue: mockLlmService },
      ],
    }).compile();

    service = module.get<TtsService>(TtsService);
    llmService = module.get(LlmService) as jest.Mocked<LlmService>;
  });

  describe('rewriteForSpeech', () => {
    it('should call LLM with narrator prompt and return script text', async () => {
      const result = await service.rewriteForSpeech('Some answer text about AI agents');

      expect(llmService.getModel).toHaveBeenCalled();
      expect(result).toContain("I'm VoxPopuli");
      expect(typeof result).toBe('string');
    });

    it('should truncate output exceeding 2500 characters', async () => {
      const longContent = 'A'.repeat(3000);
      mockLlmService.getModel().invoke.mockResolvedValueOnce({ content: longContent });

      const result = await service.rewriteForSpeech('test');

      expect(result.length).toBeLessThanOrEqual(2500);
    });
  });

  describe('streamAudio', () => {
    it('should return a Readable stream', async () => {
      const stream = await service.streamAudio('Test narration script');

      expect(stream).toBeInstanceOf(Readable);
    });
  });

  describe('narrate', () => {
    it('should return stream and character count', async () => {
      const result = await service.narrate('Answer text', { rewrite: true });

      expect(result.stream).toBeInstanceOf(Readable);
      expect(result.characterCount).toBeGreaterThan(0);
    });

    it('should skip rewrite when rewrite is false', async () => {
      const callsBefore = mockLlmService.getModel.mock.calls.length;

      const result = await service.narrate('Raw text for TTS', { rewrite: false });

      // getModel should not have been called again (no rewrite means no LLM call)
      expect(mockLlmService.getModel.mock.calls.length).toBe(callsBefore);
      expect(result.characterCount).toBe('Raw text for TTS'.length);
    });
  });
});
