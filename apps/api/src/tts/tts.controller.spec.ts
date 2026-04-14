import { Test, TestingModule } from '@nestjs/testing';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Readable } from 'node:stream';

// Mock LLM provider modules to avoid ESM resolution issues
jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

// Mock the elevenlabs SDK
jest.mock('elevenlabs', () => ({
  ElevenLabsClient: jest.fn().mockImplementation(() => ({})),
}));

/** Create a mock Express Response. */
function createMockRes() {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    end: jest.fn(),
    headersSent: false,
  };
}

describe('TtsController', () => {
  let controller: TtsController;
  let ttsService: jest.Mocked<TtsService>;

  const mockTtsService = {
    narrate: jest.fn().mockImplementation(() =>
      Promise.resolve({
        stream: Readable.from([Buffer.from('fake-audio')]),
        characterCount: 150,
      }),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TtsController],
      providers: [{ provide: TtsService, useValue: mockTtsService }],
    }).compile();

    controller = module.get<TtsController>(TtsController);
    ttsService = module.get(TtsService) as jest.Mocked<TtsService>;

    // Reset rate limiter between tests
    (controller as unknown as { requestTimestamps: number[] }).requestTimestamps = [];
  });

  describe('POST /api/tts/narrate', () => {
    it('should buffer audio and set Content-Length, Content-Type, and X-TTS-Characters', async () => {
      const mockRes = createMockRes();

      await controller.narrate({ text: 'Hello world', rewrite: true }, mockRes as never);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-TTS-Characters', '150');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', 10); // 'fake-audio'.length
      expect(mockRes.end).toHaveBeenCalledWith(Buffer.from('fake-audio'));
    });

    it('should throw 400 for empty text', async () => {
      const mockRes = createMockRes();

      await expect(controller.narrate({ text: '' }, mockRes as never)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw 400 for text exceeding 10000 characters', async () => {
      const mockRes = createMockRes();

      await expect(
        controller.narrate({ text: 'A'.repeat(10001) }, mockRes as never),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('GET /api/tts/voices', () => {
    it('should return voice configuration', () => {
      const result = controller.voices();

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('settings');
      expect(result.settings).toHaveProperty('stability');
    });
  });

  describe('rate limiting', () => {
    it('should throw 429 after exceeding rate limit', async () => {
      const mockRes = createMockRes();
      const timestamps = controller as unknown as { requestTimestamps: number[] };

      // Fill up rate limit
      for (let i = 0; i < 60; i++) {
        timestamps.requestTimestamps.push(Date.now());
      }

      await expect(controller.narrate({ text: 'test' }, mockRes as never)).rejects.toThrow(
        HttpException,
      );
    });
  });
});
