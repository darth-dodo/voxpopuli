import { Controller, Post, Get, Body, Res, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { TtsService, TtsUpstreamError } from './tts.service';
import { TtsRequest, VoiceConfig } from '@voxpopuli/shared-types';
import { MISTRAL_TTS_DEFAULT_VOICE, MISTRAL_TTS_MODEL_ID } from '../llm/model-ids';

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const MAX_INPUT_LENGTH = 10_000;
/** Voxtral voice ids are preset slugs (en_paul_neutral) or custom-voice UUIDs. */
const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Controller for TTS (text-to-speech) endpoints.
 *
 * Provides a narration endpoint that returns MP3 audio synthesised by
 * Mistral Voxtral TTS, and a voice configuration endpoint.
 */
@Controller('tts')
export class TtsController {
  private readonly requestTimestamps: number[] = [];

  constructor(
    private readonly ttsService: TtsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate narrated audio for the given text.
   *
   * Optionally rewrites the text into a podcast-style script before
   * synthesising speech via Mistral Voxtral. The audio is returned as one
   * complete response with Content-Length for compatibility with
   * reverse proxies (Render, Cloudflare) that drop chunked streams.
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

    if (body.voiceId !== undefined && !VOICE_ID_PATTERN.test(body.voiceId)) {
      throw new HttpException('Invalid voiceId', HttpStatus.BAD_REQUEST);
    }

    this.enforceRateLimit();

    try {
      const { audio, contentType, characterCount } = await this.ttsService.narrate(body.text, {
        rewrite: body.rewrite,
        voiceId: body.voiceId,
      });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', audio.length);
      res.setHeader('X-TTS-Characters', String(characterCount));
      res.setHeader('Cache-Control', 'no-cache');
      res.end(audio);
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const message = error instanceof Error ? error.message : 'TTS narration failed';
      throw new HttpException(
        message,
        error instanceof TtsUpstreamError
          ? HttpStatus.BAD_GATEWAY
          : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Return the current voice configuration used for narration.
   */
  @Get('voices')
  voices(): VoiceConfig {
    const voice = this.configService.get<string>('MISTRAL_TTS_VOICE', MISTRAL_TTS_DEFAULT_VOICE);
    return {
      id: voice,
      name: voice,
      model: this.configService.get<string>('MISTRAL_TTS_MODEL', MISTRAL_TTS_MODEL_ID),
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
