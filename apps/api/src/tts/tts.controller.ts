import { Controller, Post, Get, Body, Res, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { TtsService } from './tts.service';
import { TtsRequest, VoiceConfig } from '@voxpopuli/shared-types';
import { ELEVENLABS_MODEL_ID, ELEVENLABS_DEFAULT_VOICE_ID } from '../llm/model-ids';

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
   * Generate narrated audio for the given text.
   *
   * Optionally rewrites the text into a podcast-style script before
   * synthesising speech via ElevenLabs. The audio stream is buffered
   * into a complete response with Content-Length for compatibility
   * with reverse proxies (Render, Cloudflare) that drop chunked streams.
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

      // Buffer the stream into a single Buffer for reliable delivery
      // through reverse proxies that don't support chunked transfer.
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const audioBuffer = Buffer.concat(chunks);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('X-TTS-Characters', String(characterCount));
      res.setHeader('Cache-Control', 'no-cache');
      res.end(audioBuffer);
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
      id: ELEVENLABS_DEFAULT_VOICE_ID,
      name: 'Brian',
      model: ELEVENLABS_MODEL_ID,
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
