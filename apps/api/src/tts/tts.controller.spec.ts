import { Test, TestingModule } from '@nestjs/testing';
import { TtsController } from './tts.controller';
import { ConfigService } from '@nestjs/config';
import { TtsService, TtsUpstreamError } from './tts.service';
import { HttpException, HttpStatus } from '@nestjs/common';

// Mock LLM provider modules to avoid ESM resolution issues
jest.mock('../llm/providers/openrouter.provider', () => ({ OpenRouterProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

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
        audio: Buffer.from('fake-audio'),
        contentType: 'audio/mpeg',
        characterCount: 150,
      }),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TtsController],
      providers: [
        { provide: TtsService, useValue: mockTtsService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, defaultValue?: string) => defaultValue) },
        },
      ],
    }).compile();

    controller = module.get<TtsController>(TtsController);
    ttsService = module.get(TtsService) as jest.Mocked<TtsService>;

    // Reset rate limiter between tests
    (controller as unknown as { requestTimestamps: number[] }).requestTimestamps = [];
  });

  describe('POST /api/tts/narrate', () => {
    it('should send audio with Content-Length, Content-Type, and X-TTS-Characters', async () => {
      const mockRes = createMockRes();

      await controller.narrate({ text: 'Hello world', rewrite: true }, mockRes as never);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-TTS-Characters', '150');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', 10); // 'fake-audio'.length
      expect(mockRes.end).toHaveBeenCalledWith(Buffer.from('fake-audio'));
    });

    it('should throw 400 for a malformed voiceId', async () => {
      const mockRes = createMockRes();

      await expect(
        controller.narrate({ text: 'Hello', voiceId: '../../etc/passwd' }, mockRes as never),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(ttsService.narrate).not.toHaveBeenCalledWith('Hello', expect.anything());
    });

    it('should pass a valid voice through to the service', async () => {
      const mockRes = createMockRes();

      await controller.narrate({ text: 'Hello', voiceId: 'gb_jane_neutral' }, mockRes as never);

      expect(ttsService.narrate).toHaveBeenCalledWith('Hello', {
        rewrite: undefined,
        voiceId: 'gb_jane_neutral',
      });
    });

    it('should map TtsUpstreamError to 502 Bad Gateway', async () => {
      const mockRes = createMockRes();
      mockTtsService.narrate.mockRejectedValueOnce(new TtsUpstreamError('Voice not found'));

      await expect(controller.narrate({ text: 'Hello' }, mockRes as never)).rejects.toMatchObject({
        status: HttpStatus.BAD_GATEWAY,
      });
    });

    it('should map other errors to 500', async () => {
      const mockRes = createMockRes();
      mockTtsService.narrate.mockRejectedValueOnce(new Error('LLM rewrite failed'));

      await expect(controller.narrate({ text: 'Hello' }, mockRes as never)).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
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
      expect(result).toEqual({
        id: 'en_paul_neutral',
        name: 'en_paul_neutral',
        model: 'voxtral-mini-tts-latest',
      });
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
