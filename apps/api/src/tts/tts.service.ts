import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { NARRATOR_SYSTEM_PROMPT, MAX_NARRATION_CHARS } from './prompts/narrator.prompt';
import {
  MISTRAL_API_BASE_URL,
  MISTRAL_TTS_DEFAULT_VOICE,
  MISTRAL_TTS_MODEL_ID,
} from '../llm/model-ids';

/** Upper bound for a single speech synthesis request. */
const TTS_TIMEOUT_MS = 60_000;

/** Content type of the audio returned by {@link TtsService.synthesize}. */
export const TTS_CONTENT_TYPE = 'audio/mpeg';

/** Failure reported by (or while talking to) the upstream TTS service. */
export class TtsUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsUpstreamError';
  }
}

/** Synthesised narration audio. */
export interface NarrationAudio {
  audio: Buffer;
  contentType: string;
  characterCount: number;
}

/** Fields we read from a Mistral `/audio/speech` JSON response (success or error). */
interface SpeechResponseBody {
  audio_data?: string;
  message?: string;
  detail?: unknown;
}

/**
 * Narration via Mistral Voxtral text-to-speech.
 *
 * Text is optionally rewritten into a podcast script by the active LLM, then
 * spoken by Voxtral (`MISTRAL_TTS_MODEL`, default `voxtral-mini-tts-latest`)
 * using `MISTRAL_API_KEY`. The API returns base64 MP3 in a JSON body.
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly voice: string;

  constructor(
    private readonly llmService: LlmService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('MISTRAL_API_KEY');
    this.model = this.configService.get<string>('MISTRAL_TTS_MODEL', MISTRAL_TTS_MODEL_ID);
    this.voice = this.configService.get<string>('MISTRAL_TTS_VOICE', MISTRAL_TTS_DEFAULT_VOICE);
  }

  /**
   * Full narration pipeline: optionally rewrite text, then synthesise audio.
   *
   * @param text    - Answer text to narrate
   * @param options - `rewrite` (default true) and an optional `voiceId` override
   * @returns MP3 audio plus the number of characters spoken
   */
  async narrate(
    text: string,
    options?: { rewrite?: boolean; voiceId?: string },
  ): Promise<NarrationAudio> {
    const shouldRewrite = options?.rewrite !== false;
    const script = shouldRewrite
      ? await this.rewriteForSpeech(text)
      : text.slice(0, MAX_NARRATION_CHARS);

    this.logger.log(`Narrating ${script.length} chars (rewrite=${shouldRewrite})`);

    const audio = await this.synthesize(script, options?.voiceId);
    return { audio, contentType: TTS_CONTENT_TYPE, characterCount: script.length };
  }

  /**
   * Single-turn LLM call to transform answer text into a podcast narration script.
   *
   * @param text - Answer text
   * @returns Narration script, capped at MAX_NARRATION_CHARS
   */
  async rewriteForSpeech(text: string): Promise<string> {
    const chatModel = this.llmService.getModel();
    const response = await chatModel.invoke([
      new SystemMessage(NARRATOR_SYSTEM_PROMPT),
      new HumanMessage(text),
    ]);

    let script = typeof response.content === 'string' ? response.content : String(response.content);

    if (script.length > MAX_NARRATION_CHARS) {
      this.logger.warn(
        `Narrator output ${script.length} chars, truncating to ${MAX_NARRATION_CHARS}`,
      );
      script = script.slice(0, MAX_NARRATION_CHARS);
    }

    return script;
  }

  /**
   * Speak a script with Voxtral and return MP3 audio.
   *
   * @param script - Text to speak
   * @param voice  - Voice override: preset slug or custom voice id (defaults to MISTRAL_TTS_VOICE)
   * @returns MP3 audio buffer
   * @throws TtsUpstreamError if Mistral rejects the request or returns no audio
   */
  async synthesize(script: string, voice?: string): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error('MISTRAL_API_KEY is required for text-to-speech');
    }

    const response = await fetch(`${MISTRAL_API_BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: script,
        voice_id: voice ?? this.voice,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });

    const raw = await response.text();
    let body: SpeechResponseBody = {};
    try {
      body = JSON.parse(raw) as SpeechResponseBody;
    } catch {
      // Non-JSON body (e.g. gateway error page) — reported below.
    }

    if (!response.ok) {
      const reason = body.message ?? (body.detail ? JSON.stringify(body.detail) : raw);
      throw new TtsUpstreamError(`Mistral TTS request failed (${response.status}): ${reason}`);
    }
    if (!body.audio_data) {
      throw new TtsUpstreamError('Mistral TTS returned no audio');
    }
    return Buffer.from(body.audio_data, 'base64');
  }
}
