import { Controller, Post, Get, Body, Res, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { TtsService } from './tts.service';
import { TtsRequest, VoiceConfig } from '@voxpopuli/shared-types';

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const MAX_INPUT_LENGTH = 10_000;

/**
 * Controller for TTS (text-to-speech) endpoints.
 *
 * Provides a streaming narration endpoint that pipes chunked MP3 audio
 * directly to the response, and a voice configuration endpoint.
 */
@Controller('tts')
export class TtsController {
  private readonly requestTimestamps: number[] = [];

  constructor(private readonly ttsService: TtsService) {}

  /**
   * Stream narrated audio for the given text.
   *
   * Optionally rewrites the text into a podcast-style script before
   * synthesising speech via ElevenLabs.  The response is a chunked
   * `audio/mpeg` stream with character count metadata in headers.
   */
  @Post('narrate')
  async narrate(@Body() body: TtsRequest, @Res() res: Response): Promise<void> {
    if (!body.text || body.text.trim().length === 0) {
      throw new HttpException('Text is required', HttpStatus.BAD_REQUEST);
    }
    if (body.text.length > MAX_INPUT_LENGTH) {
      throw new HttpException(
        `Text must be ${MAX_INPUT_LENGTH} characters or less`,
        HttpStatus.BAD_REQUEST,
      );
    }

    this.enforceRateLimit();

    try {
      const { stream, characterCount } = await this.ttsService.narrate(body.text, {
        rewrite: body.rewrite,
        voiceId: body.voiceId,
      });

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('X-TTS-Characters', String(characterCount));
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'no-cache');

      stream.pipe(res);

      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(HttpStatus.BAD_GATEWAY).json({ message: 'Audio streaming failed' });
        }
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const message = error instanceof Error ? error.message : 'TTS narration failed';
      const isUpstream =
        message.toLowerCase().includes('elevenlabs') || message.toLowerCase().includes('upstream');

      throw new HttpException(
        message,
        isUpstream ? HttpStatus.BAD_GATEWAY : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Return the current voice configuration used for narration.
   */
  @Get('voices')
  voices(): VoiceConfig {
    return {
      id: 'nPczCjzI2devNBz1zQrb',
      name: 'Brian',
      model: 'eleven_multilingual_v2',
      settings: {
        stability: 0.65,
        similarityBoost: 0.75,
        style: 0.35,
        useSpeakerBoost: true,
      },
    };
  }

  /**
   * Enforce the global rate limit.
   * Prunes old timestamps and throws 429 if the limit is exceeded.
   */
  private enforceRateLimit(): void {
    const now = Date.now();
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < now - RATE_WINDOW_MS) {
      this.requestTimestamps.shift();
    }
    if (this.requestTimestamps.length >= RATE_LIMIT) {
      throw new HttpException(
        'Rate limit exceeded. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.requestTimestamps.push(now);
  }
}
