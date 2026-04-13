import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { ElevenLabsClient } from 'elevenlabs';
import { LlmService } from '../llm/llm.service';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { NARRATOR_SYSTEM_PROMPT, MAX_NARRATION_CHARS } from './prompts/narrator.prompt';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly client: ElevenLabsClient;
  private readonly voiceId: string;
  private readonly model: string;

  constructor(
    private readonly llmService: LlmService,
    private readonly configService: ConfigService,
  ) {
    this.client = new ElevenLabsClient({
      apiKey: this.configService.get<string>('ELEVENLABS_API_KEY'),
    });
    this.voiceId = this.configService.get<string>('ELEVENLABS_VOICE_ID', 'nPczCjzI2devNBz1zQrb');
    this.model = this.configService.get<string>('ELEVENLABS_MODEL', 'eleven_multilingual_v2');
  }

  /**
   * Full narration pipeline: optionally rewrite text, then stream audio.
   */
  async narrate(
    text: string,
    options?: { rewrite?: boolean; voiceId?: string },
  ): Promise<{ stream: Readable; characterCount: number }> {
    const shouldRewrite = options?.rewrite !== false;
    const script = shouldRewrite
      ? await this.rewriteForSpeech(text)
      : text.slice(0, MAX_NARRATION_CHARS);
    const voiceId = options?.voiceId ?? this.voiceId;

    this.logger.log(`Narrating ${script.length} chars (rewrite=${shouldRewrite})`);

    const stream = await this.streamAudio(script, voiceId);
    return { stream, characterCount: script.length };
  }

  /**
   * Single-turn LLM call to transform answer text into a podcast narration script.
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
   * Stream audio from ElevenLabs TTS API.
   */
  async streamAudio(script: string, voiceId?: string): Promise<Readable> {
    const stream = await this.client.textToSpeech.convertAsStream(voiceId ?? this.voiceId, {
      text: script,
      model_id: this.model,
      voice_settings: {
        stability: 0.65,
        similarity_boost: 0.75,
        style: 0.35,
        use_speaker_boost: true,
      },
    });

    return stream;
  }
}
