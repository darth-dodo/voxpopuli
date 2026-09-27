import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { NARRATOR_SYSTEM_PROMPT, MAX_NARRATION_CHARS } from './prompts/narrator.prompt';
import { SPEECH_SYSTEM_PROMPT } from './prompts/speech.prompt';
import {
  OPENROUTER_BASE_URL,
  OPENROUTER_TTS_DEFAULT_VOICE,
  OPENROUTER_TTS_MODEL_ID,
} from '../llm/model-ids';
import { pcm16ToWav } from './wav';

/** Upper bound for a single speech synthesis request. */
const TTS_TIMEOUT_MS = 120_000;

/** Content type of the audio returned by {@link TtsService.synthesize}. */
export const TTS_CONTENT_TYPE = 'audio/wav';

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

/** Shape of one OpenRouter chat-completions stream chunk (fields we read). */
interface AudioStreamChunk {
  error?: { message?: string };
  choices?: { delta?: { audio?: { data?: string; transcript?: string } } }[];
}

/**
 * Narration via OpenRouter audio output.
 *
 * Text is optionally rewritten into a podcast script by the active LLM, then
 * spoken by an OpenRouter audio model (`OPENROUTER_TTS_MODEL`, default
 * `openai/gpt-audio-mini`). OpenRouter only returns audio over SSE, as base64
 * `pcm16` chunks, which are concatenated and wrapped in a WAV header.
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
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    this.model = this.configService.get<string>('OPENROUTER_TTS_MODEL', OPENROUTER_TTS_MODEL_ID);
    this.voice = this.configService.get<string>(
      'OPENROUTER_TTS_VOICE',
      OPENROUTER_TTS_DEFAULT_VOICE,
    );
  }

  /**
   * Full narration pipeline: optionally rewrite text, then synthesise audio.
   *
   * @param text    - Answer text to narrate
   * @param options - `rewrite` (default true) and an optional `voiceId` override
   * @returns WAV audio plus the number of characters spoken
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
   * Speak a script with the OpenRouter audio model and return a WAV file.
   *
   * @param script - Text to read aloud verbatim
   * @param voice  - Voice override (defaults to OPENROUTER_TTS_VOICE)
   * @returns WAV audio buffer
   * @throws TtsUpstreamError if OpenRouter rejects the request or returns no audio
   */
  async synthesize(script: string, voice?: string): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is required for text-to-speech');
    }

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'VoxPopuli',
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        modalities: ['text', 'audio'],
        audio: { voice: voice ?? this.voice, format: 'pcm16' },
        messages: [
          { role: 'system', content: SPEECH_SYSTEM_PROMPT },
          { role: 'user', content: script },
        ],
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });

    if (!response.ok || !response.body) {
      throw new TtsUpstreamError(
        `OpenRouter TTS request failed (${response.status}): ${await readErrorMessage(response)}`,
      );
    }

    const pcm = await collectPcm(response.body);
    if (pcm.length === 0) {
      throw new TtsUpstreamError('OpenRouter TTS returned no audio');
    }
    return pcm16ToWav(pcm);
  }
}

/** Extract `error.message` from an OpenRouter error body, falling back to raw text. */
async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as AudioStreamChunk;
    return parsed.error?.message ?? body;
  } catch {
    return body || response.statusText;
  }
}

/**
 * Read an OpenRouter SSE stream and concatenate the base64 audio chunks.
 * Lines are `data: {json}`; comment lines (`: OPENROUTER PROCESSING`) and
 * `data: [DONE]` are skipped. An in-stream `error` payload aborts the read.
 */
async function collectPcm(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const decoder = new TextDecoder();
  const chunks: Buffer[] = [];
  let pending = '';

  const handleLine = (line: string): void => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;

    const chunk = JSON.parse(payload) as AudioStreamChunk;
    if (chunk.error) {
      throw new TtsUpstreamError(
        `OpenRouter TTS stream error: ${chunk.error.message ?? 'unknown'}`,
      );
    }
    for (const choice of chunk.choices ?? []) {
      const data = choice.delta?.audio?.data;
      if (data) chunks.push(Buffer.from(data, 'base64'));
    }
  };

  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    lines.forEach(handleLine);
  }
  handleLine(pending + decoder.decode());

  return Buffer.concat(chunks);
}
