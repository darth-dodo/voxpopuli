import { Controller, Post, Get, Body, Res, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { TtsService, TtsUpstreamError } from './tts.service';
import { TtsRequest, VoiceConfig } from '@voxpopuli/shared-types';
import {
  OPENROUTER_TTS_DEFAULT_VOICE,
  OPENROUTER_TTS_MODEL_ID,
  OPENROUTER_TTS_VOICES,
} from '../llm/model-ids';

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const MAX_INPUT_LENGTH = 10_000;

/**
 * Controller for TTS (text-to-speech) endpoints.
 *
 * Provides a narration endpoint that returns WAV audio synthesised via
 * OpenRouter audio output, and a voice configuration endpoint.
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
   * synthesising speech via OpenRouter. The audio is returned as one
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

    if (
      body.voiceId !== undefined &&
      !(OPENROUTER_TTS_VOICES as readonly string[]).includes(body.voiceId)
    ) {
      throw new HttpException(
        `Unknown voice "${body.voiceId}". Valid voices: ${OPENROUTER_TTS_VOICES.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
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
    const voice = this.configService.get<string>(
      'OPENROUTER_TTS_VOICE',
      OPENROUTER_TTS_DEFAULT_VOICE,
    );
    return {
      id: voice,
      name: voice.charAt(0).toUpperCase() + voice.slice(1),
      model: this.configService.get<string>('OPENROUTER_TTS_MODEL', OPENROUTER_TTS_MODEL_ID),
      availableVoices: [...OPENROUTER_TTS_VOICES],
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
