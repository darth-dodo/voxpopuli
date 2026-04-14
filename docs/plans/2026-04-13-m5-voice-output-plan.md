# M5: Voice Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add podcast-style TTS narration to VoxPopuli answers via ElevenLabs, with a "Listen" pill in the sticky header that expands into an inline audio player.

**Architecture:** Backend TtsModule with narrator persona prompt (single-turn LLM rewrite) + ElevenLabs SDK streaming. Frontend AudioPlayerComponent with 6-state machine, mobile-first buffered playback with MediaSource progressive enhancement on desktop.

**Tech Stack:** NestJS, ElevenLabs SDK (`elevenlabs`), LangChain (via LlmService), Angular 21 standalone components with signals, Tailwind v4, inline SVGs.

**Design Spec:** `docs/plans/2026-04-13-m5-voice-output-design.md`

---

## File Structure

### Backend (new files)

| File                                          | Responsibility                                                 |
| --------------------------------------------- | -------------------------------------------------------------- |
| `apps/api/src/tts/tts.module.ts`              | NestJS module, imports LlmModule + ConfigModule                |
| `apps/api/src/tts/tts.service.ts`             | Core TTS: `rewriteForSpeech()` + `streamAudio()` + `narrate()` |
| `apps/api/src/tts/tts.controller.ts`          | `POST /api/tts/narrate`, `GET /api/tts/voices`, rate limiting  |
| `apps/api/src/tts/tts.service.spec.ts`        | Unit tests for TtsService                                      |
| `apps/api/src/tts/tts.controller.spec.ts`     | Unit tests for TtsController                                   |
| `apps/api/src/tts/prompts/narrator.prompt.ts` | Rich narrator persona system prompt                            |

### Backend (modified files)

| File                                        | Change                                        |
| ------------------------------------------- | --------------------------------------------- |
| `apps/api/src/app/app.module.ts`            | Add `TtsModule` to imports                    |
| `libs/shared-types/src/lib/shared-types.ts` | Add `VoiceConfig`, `VoiceSettings` interfaces |

### Frontend (new files)

| File                                                                      | Responsibility                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `apps/web/src/app/components/audio-player/audio-player.component.ts`      | Standalone AudioPlayerComponent with state machine   |
| `apps/web/src/app/components/audio-player/audio-player.component.html`    | Player template (idle pill, expanded player, error)  |
| `apps/web/src/app/components/audio-player/audio-player.component.spec.ts` | Unit tests                                           |
| `apps/web/src/app/services/tts.service.ts`                                | Frontend TtsService: fetch + chunk collection + Blob |
| `apps/web/src/app/services/tts.service.spec.ts`                           | Unit tests                                           |

### Frontend (modified files)

| File                                                   | Change                                                 |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `apps/web/src/app/components/chat/chat.component.ts`   | Import AudioPlayerComponent, add answer-ready computed |
| `apps/web/src/app/components/chat/chat.component.html` | Add `<app-audio-player>` in sticky header              |

### Infrastructure

| File                       | Change                        |
| -------------------------- | ----------------------------- |
| `package.json`             | Add `elevenlabs` dependency   |
| `apps/web/proxy.conf.json` | Add `/api/tts/**` proxy route |

---

## Task 1: Install ElevenLabs SDK + Add Shared Types

**Files:**

- Modify: `package.json`
- Modify: `libs/shared-types/src/lib/shared-types.ts`

- [ ] **Step 1: Install the ElevenLabs SDK**

```bash
pnpm add elevenlabs
```

- [ ] **Step 2: Add VoiceConfig and VoiceSettings to shared types**

Open `libs/shared-types/src/lib/shared-types.ts` and add after the existing `RewriteTrustMetadata` interface:

```typescript
export interface VoiceSettings {
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
}

export interface VoiceConfig {
  id: string;
  name: string;
  model: string;
  settings: VoiceSettings;
}
```

- [ ] **Step 3: Verify types compile**

```bash
npx nx build shared-types
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml libs/shared-types/
git commit -m "feat(m5): install elevenlabs SDK and add VoiceConfig shared types"
```

---

## Task 2: Narrator Prompt

**Files:**

- Create: `apps/api/src/tts/prompts/narrator.prompt.ts`

- [ ] **Step 1: Create the prompts directory and narrator prompt**

```bash
mkdir -p apps/api/src/tts/prompts
```

Write `apps/api/src/tts/prompts/narrator.prompt.ts`:

```typescript
export const NARRATOR_SYSTEM_PROMPT = `You are the voice of VoxPopuli — a calm, editorial narrator who distills Hacker News discourse into concise podcast-style scripts.

## VOICE
- Tone: Calm, editorial, slightly opinionated — like a tech-savvy NPR host.
- Pacing: Conversational but efficient. Avoid filler words.
- Personality: You have opinions but ground them in what the community said.

## TASK
Transform the provided answer text into a spoken narration script. The script will be read aloud by a text-to-speech engine, so it must sound natural when spoken.

## STRUCTURE
1. **Opening hook** (1-2 sentences): Capture the core tension or question. Start with something that makes the listener lean in.
2. **Body** (3-6 sentences): Walk through the key points. Attribute claims to specific users or the community. Use transitions between ideas.
3. **Sign-off**: Always end with exactly: "That's the signal from HN. I'm VoxPopuli."

## FIDELITY RULES (CRITICAL)
- Do NOT invent claims, statistics, or opinions not present in the source text.
- Preserve ALL attributions. If the source says "user swyx said X", your script must attribute X to swyx.
- Convert markdown citations to spoken form:
  - "[Story 12345]" → omit the reference number, refer to the story by title or topic
  - "swyx (340 points)" → "swyx, with over 340 points"
  - "Posted: 2026-04-01" → "posted earlier this month" or similar natural phrasing
- If the source mentions point counts or comment counts, you may round them ("over 300 points", "dozens of comments").

## VOICE DIRECTION
- Use natural pauses: commas and periods create breathing room for the TTS engine.
- Emphasize key terms by placing them at the start of sentences.
- Avoid parenthetical asides — they sound awkward when spoken.
- No bullet points, numbered lists, or markdown formatting.
- No URLs, links, or code blocks.

## CONSTRAINTS
- Output MUST be plain text only. No markdown, no formatting.
- Output MUST be under 2500 characters total.
- Do NOT include any preamble like "Here's the narration:" — start directly with the hook.
- Do NOT add a title or heading.
`;

export const MAX_NARRATION_CHARS = 2500;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/tts/prompts/
git commit -m "feat(m5): add narrator persona system prompt"
```

---

## Task 3: TtsService (Backend)

**Files:**

- Create: `apps/api/src/tts/tts.service.ts`
- Create: `apps/api/src/tts/tts.service.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/api/src/tts/tts.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TtsService } from './tts.service';
import { LlmService } from '../llm/llm.service';
import { Readable } from 'node:stream';

// Mock the elevenlabs SDK
jest.mock('elevenlabs', () => ({
  ElevenLabsClient: jest.fn().mockImplementation(() => ({
    textToSpeech: {
      convertAsStream: jest.fn().mockResolvedValue(Readable.from([Buffer.from('fake-mp3-data')])),
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
      const result = await service.narrate('Raw text for TTS', { rewrite: false });

      expect(llmService.getModel().invoke).not.toHaveBeenCalled();
      expect(result.characterCount).toBe('Raw text for TTS'.length);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx nx test api --testPathPattern=tts.service.spec --no-coverage
```

Expected: FAIL — `Cannot find module './tts.service'`

- [ ] **Step 3: Write the TtsService implementation**

Create `apps/api/src/tts/tts.service.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx nx test api --testPathPattern=tts.service.spec --no-coverage
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tts/tts.service.ts apps/api/src/tts/tts.service.spec.ts
git commit -m "feat(m5): implement TtsService with rewrite and stream"
```

---

## Task 4: TtsController (Backend)

**Files:**

- Create: `apps/api/src/tts/tts.controller.ts`
- Create: `apps/api/src/tts/tts.controller.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/api/src/tts/tts.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Readable } from 'node:stream';

describe('TtsController', () => {
  let controller: TtsController;
  let ttsService: jest.Mocked<TtsService>;

  const mockTtsService = {
    narrate: jest.fn().mockResolvedValue({
      stream: Readable.from([Buffer.from('fake-audio')]),
      characterCount: 150,
    }),
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
    it('should set audio/mpeg content type and X-TTS-Characters header', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        on: jest.fn(),
      };

      await controller.narrate({ text: 'Hello world', rewrite: true }, mockRes as never);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-TTS-Characters', '150');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
    });

    it('should throw 400 for empty text', async () => {
      const mockRes = { setHeader: jest.fn(), on: jest.fn() };

      await expect(controller.narrate({ text: '' }, mockRes as never)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw 400 for text exceeding 10000 characters', async () => {
      const mockRes = { setHeader: jest.fn(), on: jest.fn() };

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
      const mockRes = { setHeader: jest.fn(), on: jest.fn() };
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx nx test api --testPathPattern=tts.controller.spec --no-coverage
```

Expected: FAIL — `Cannot find module './tts.controller'`

- [ ] **Step 3: Write the TtsController implementation**

Create `apps/api/src/tts/tts.controller.ts`:

```typescript
import { Controller, Post, Get, Body, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { TtsService } from './tts.service';
import { TtsRequest, VoiceConfig } from '@voxpopuli/shared-types';

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const MAX_INPUT_LENGTH = 10_000;

@Controller('tts')
export class TtsController {
  private readonly requestTimestamps: number[] = [];

  constructor(private readonly ttsService: TtsService) {}

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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx nx test api --testPathPattern=tts.controller.spec --no-coverage
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tts/tts.controller.ts apps/api/src/tts/tts.controller.spec.ts
git commit -m "feat(m5): implement TtsController with narrate and voices endpoints"
```

---

## Task 5: TtsModule + AppModule Wiring

**Files:**

- Create: `apps/api/src/tts/tts.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

- [ ] **Step 1: Create TtsModule**

Create `apps/api/src/tts/tts.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [TtsController],
  providers: [TtsService],
})
export class TtsModule {}
```

- [ ] **Step 2: Register TtsModule in AppModule**

In `apps/api/src/app/app.module.ts`, add the import:

```typescript
import { TtsModule } from '../tts/tts.module';
```

Add `TtsModule` to the `imports` array, after `RagModule`:

```typescript
imports: [
  // ... existing imports ...
  RagModule,
  TtsModule,
],
```

- [ ] **Step 3: Verify the API builds**

```bash
npx nx build api
```

Expected: Build succeeds.

- [ ] **Step 4: Run all backend tests**

```bash
npx nx test api --no-coverage
```

Expected: All tests pass, including new TTS tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tts/tts.module.ts apps/api/src/app/app.module.ts
git commit -m "feat(m5): wire TtsModule into AppModule"
```

---

## Task 6: Frontend Proxy Config

**Files:**

- Modify: `apps/web/proxy.conf.json`

- [ ] **Step 1: Add TTS proxy route**

Open `apps/web/proxy.conf.json` and add the TTS route. The file should look like:

```json
{
  "/api/**": {
    "target": "http://localhost:3000",
    "secure": false,
    "changeOrigin": true
  }
}
```

If `/api/**` is already the pattern (it should be per Angular 21's Vite dev server requirements), TTS routes are already covered. Verify this is the case.

- [ ] **Step 2: Verify proxy works**

Start both servers and test:

```bash
# Terminal 1
npx nx serve api
# Terminal 2
npx nx serve web
# Terminal 3 — test the voices endpoint through proxy
curl http://localhost:4200/api/tts/voices
```

Expected: Returns JSON with voice config.

- [ ] **Step 3: Commit (if changes were made)**

```bash
git add apps/web/proxy.conf.json
git commit -m "feat(m5): add TTS proxy route for dev server"
```

---

## Task 7: Frontend TtsService

**Files:**

- Create: `apps/web/src/app/services/tts.service.ts`
- Create: `apps/web/src/app/services/tts.service.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/web/src/app/services/tts.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { TtsService, TtsResult } from './tts.service';

describe('TtsService', () => {
  let service: TtsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TtsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should narrate text and return a blob', (done) => {
    const fakeChunk = new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // Fake MP3 header bytes
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(fakeChunk);
        controller.close();
      },
    });

    const mockResponse = new Response(fakeStream, {
      status: 200,
      headers: { 'X-TTS-Characters': '100' },
    });

    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    service.narrate('Test text').subscribe({
      next: (result: TtsResult) => {
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.blob.type).toBe('audio/mpeg');
        expect(result.characterCount).toBe(100);
        done();
      },
      error: done.fail,
    });
  });

  it('should throw on non-ok response', (done) => {
    const mockResponse = new Response('Rate limit exceeded', {
      status: 429,
      statusText: 'Too Many Requests',
    });

    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    service.narrate('Test text').subscribe({
      next: () => done.fail('should not emit'),
      error: (err) => {
        expect(err.message).toContain('429');
        done();
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx nx test web --testPathPattern=tts.service.spec --no-coverage
```

Expected: FAIL — `Cannot find module './tts.service'`

- [ ] **Step 3: Write the TtsService implementation**

Create `apps/web/src/app/services/tts.service.ts`:

```typescript
import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';

export interface TtsResult {
  blob: Blob;
  characterCount: number;
}

@Injectable({ providedIn: 'root' })
export class TtsService {
  /**
   * POST to /api/tts/narrate with the answer text.
   * Reads chunked MP3 response, collects into a Blob.
   */
  narrate(text: string, rewrite = true): Observable<TtsResult> {
    return from(this.fetchNarration(text, rewrite));
  }

  private async fetchNarration(text: string, rewrite: boolean): Promise<TtsResult> {
    const response = await fetch('/api/tts/narrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, rewrite }),
    });

    if (!response.ok) {
      throw new Error(`TTS request failed: ${response.status} ${response.statusText}`);
    }

    const characterCount = parseInt(response.headers.get('X-TTS-Characters') ?? '0', 10);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const chunks: Uint8Array[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    return { blob, characterCount };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx nx test web --testPathPattern=tts.service.spec --no-coverage
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/services/tts.service.ts apps/web/src/app/services/tts.service.spec.ts
git commit -m "feat(m5): implement frontend TtsService with chunked fetch"
```

---

## Task 8: AudioPlayerComponent

**Files:**

- Create: `apps/web/src/app/components/audio-player/audio-player.component.ts`
- Create: `apps/web/src/app/components/audio-player/audio-player.component.html`
- Create: `apps/web/src/app/components/audio-player/audio-player.component.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/web/src/app/components/audio-player/audio-player.component.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AudioPlayerComponent } from './audio-player.component';
import { TtsService } from '../../services/tts.service';
import { of, throwError } from 'rxjs';

describe('AudioPlayerComponent', () => {
  let component: AudioPlayerComponent;
  let fixture: ComponentFixture<AudioPlayerComponent>;
  let mockTtsService: jest.Mocked<Pick<TtsService, 'narrate'>>;

  beforeEach(async () => {
    mockTtsService = {
      narrate: jest.fn().mockReturnValue(
        of({
          blob: new Blob(['fake-audio'], { type: 'audio/mpeg' }),
          characterCount: 100,
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [AudioPlayerComponent],
      providers: [{ provide: TtsService, useValue: mockTtsService }],
    }).compileComponents();

    fixture = TestBed.createComponent(AudioPlayerComponent);
    component = fixture.componentInstance;

    // Set required inputs
    fixture.componentRef.setInput('text', 'Test answer text');
    fixture.componentRef.setInput('disabled', false);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start in idle state', () => {
    expect(component.state()).toBe('idle');
  });

  it('should transition to loading on listen click', () => {
    component.onListen();
    expect(component.state()).toBe('loading');
    expect(mockTtsService.narrate).toHaveBeenCalledWith('Test answer text', true);
  });

  it('should not start when disabled', () => {
    fixture.componentRef.setInput('disabled', true);
    component.onListen();
    expect(component.state()).toBe('idle');
    expect(mockTtsService.narrate).not.toHaveBeenCalled();
  });

  it('should transition to error on service failure', () => {
    mockTtsService.narrate.mockReturnValue(throwError(() => new Error('API down')));
    component.onListen();
    expect(component.state()).toBe('error');
    expect(component.errorMessage()).toBe('API down');
  });

  it('should allow retry from error state', () => {
    mockTtsService.narrate.mockReturnValueOnce(throwError(() => new Error('fail')));
    component.onListen();
    expect(component.state()).toBe('error');

    // Reset mock for retry
    mockTtsService.narrate.mockReturnValue(
      of({ blob: new Blob(['audio'], { type: 'audio/mpeg' }), characterCount: 50 }),
    );
    component.onRetry();
    expect(component.state()).toBe('loading');
  });

  it('should cycle speed on speed button click', () => {
    expect(component.playbackSpeed()).toBe(1);
    component.cycleSpeed();
    expect(component.playbackSpeed()).toBe(1.25);
    component.cycleSpeed();
    expect(component.playbackSpeed()).toBe(1.5);
    component.cycleSpeed();
    expect(component.playbackSpeed()).toBe(0.75);
    component.cycleSpeed();
    expect(component.playbackSpeed()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx nx test web --testPathPattern=audio-player.component.spec --no-coverage
```

Expected: FAIL — `Cannot find module './audio-player.component'`

- [ ] **Step 3: Write the component TypeScript**

Create `apps/web/src/app/components/audio-player/audio-player.component.ts`:

```typescript
import { Component, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { TtsService } from '../../services/tts.service';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'complete' | 'error';

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

@Component({
  selector: 'app-audio-player',
  standalone: true,
  templateUrl: './audio-player.component.html',
})
export class AudioPlayerComponent implements OnDestroy {
  private readonly ttsService = inject(TtsService);
  private subscription: Subscription | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private audioBlob: Blob | null = null;

  readonly text = input.required<string>();
  readonly disabled = input(false);

  readonly state = signal<PlayerState>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly playbackSpeed = signal(1);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly progress = computed(() => {
    const d = this.duration();
    return d > 0 ? (this.currentTime() / d) * 100 : 0;
  });

  readonly formattedTime = computed(() => this.formatTime(this.currentTime()));
  readonly formattedDuration = computed(() => this.formatTime(this.duration()));

  readonly isExpanded = computed(() => {
    const s = this.state();
    return s === 'playing' || s === 'paused' || s === 'complete';
  });

  onListen(): void {
    if (this.disabled() || this.state() === 'loading') return;
    this.startNarration();
  }

  onRetry(): void {
    this.startNarration();
  }

  togglePlayPause(): void {
    if (!this.audioElement) return;

    if (this.state() === 'playing') {
      this.audioElement.pause();
      this.state.set('paused');
    } else if (this.state() === 'paused' || this.state() === 'complete') {
      if (this.state() === 'complete') {
        this.audioElement.currentTime = 0;
      }
      this.audioElement.play();
      this.state.set('playing');
    }
  }

  cycleSpeed(): void {
    const currentIndex = SPEED_OPTIONS.indexOf(
      this.playbackSpeed() as (typeof SPEED_OPTIONS)[number],
    );
    const nextIndex = (currentIndex + 1) % SPEED_OPTIONS.length;
    this.playbackSpeed.set(SPEED_OPTIONS[nextIndex]);
    if (this.audioElement) {
      this.audioElement.playbackRate = SPEED_OPTIONS[nextIndex];
    }
  }

  download(): void {
    if (!this.audioBlob) return;
    const url = URL.createObjectURL(this.audioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voxpopuli-narration.mp3';
    a.click();
    URL.revokeObjectURL(url);
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private startNarration(): void {
    this.cleanup();
    this.state.set('loading');
    this.errorMessage.set(null);

    this.subscription = this.ttsService.narrate(this.text(), true).subscribe({
      next: (result) => {
        this.audioBlob = result.blob;
        this.objectUrl = URL.createObjectURL(result.blob);
        this.setupAudio(this.objectUrl);
      },
      error: (err) => {
        this.state.set('error');
        this.errorMessage.set(err.message ?? 'Narration failed');
      },
    });
  }

  private setupAudio(url: string): void {
    this.audioElement = new Audio(url);
    this.audioElement.playbackRate = this.playbackSpeed();

    this.audioElement.addEventListener('canplay', () => {
      this.audioElement
        ?.play()
        .then(() => {
          this.state.set('playing');
        })
        .catch(() => {
          // Autoplay blocked — let user tap play
          this.state.set('paused');
        });
    });

    this.audioElement.addEventListener('timeupdate', () => {
      if (this.audioElement) {
        this.currentTime.set(this.audioElement.currentTime);
      }
    });

    this.audioElement.addEventListener('loadedmetadata', () => {
      if (this.audioElement) {
        this.duration.set(this.audioElement.duration);
      }
    });

    this.audioElement.addEventListener('ended', () => {
      this.state.set('complete');
    });

    this.audioElement.addEventListener('error', () => {
      this.state.set('error');
      this.errorMessage.set('Audio playback failed');
    });
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private cleanup(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.audioBlob = null;
    this.currentTime.set(0);
    this.duration.set(0);
  }
}
```

- [ ] **Step 4: Write the component template**

Create `apps/web/src/app/components/audio-player/audio-player.component.html`:

```html
<!-- Idle: Listen pill -->
@if (state() === 'idle') {
<button
  type="button"
  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent-amber/40 bg-accent-amber/10 text-accent-amber text-xs font-medium hover:bg-accent-amber/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
  [disabled]="disabled()"
  (click)="onListen()"
  aria-label="Listen to narration"
>
  <svg
    class="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
  Listen
</button>
}

<!-- Loading: Spinner pill -->
@if (state() === 'loading') {
<div
  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent-amber/40 bg-accent-amber/10 text-accent-amber text-xs font-medium"
>
  <svg
    class="w-3.5 h-3.5 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <circle cx="12" cy="12" r="10" stroke-opacity="0.3" />
    <path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
  Preparing...
</div>
}

<!-- Error: Message + Retry -->
@if (state() === 'error') {
<div class="inline-flex items-center gap-2 text-xs">
  <span class="text-trust-danger">{{ errorMessage() }}</span>
  <button
    type="button"
    class="px-2 py-1 rounded border border-trust-danger/40 text-trust-danger hover:bg-trust-danger/10 transition-colors cursor-pointer text-xs"
    (click)="onRetry()"
  >
    Retry
  </button>
</div>
}

<!-- Expanded Player: Playing / Paused / Complete -->
@if (isExpanded()) {
<div class="flex items-center gap-2.5 min-w-0">
  <!-- Play/Pause/Replay button -->
  <button
    type="button"
    class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-colors"
    [class]="state() === 'complete'
        ? 'border-2 border-text-muted text-text-muted hover:border-accent-amber hover:text-accent-amber'
        : state() === 'playing'
          ? 'bg-accent-amber text-surface-base'
          : 'border-2 border-accent-amber text-accent-amber hover:bg-accent-amber/10'"
    (click)="togglePlayPause()"
    [attr.aria-label]="state() === 'playing' ? 'Pause' : state() === 'complete' ? 'Replay' : 'Play'"
  >
    @if (state() === 'playing') {
    <!-- Pause icon -->
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
    } @else if (state() === 'complete') {
    <!-- Replay icon -->
    <svg
      class="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
    } @else {
    <!-- Play icon -->
    <svg class="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,3 19,12 5,21" />
    </svg>
    }
  </button>

  <!-- Progress bar -->
  <div class="flex-1 min-w-0">
    <div class="h-1 rounded-full bg-accent-amber/20">
      <div
        class="h-full rounded-full transition-all"
        [class]="state() === 'complete' ? 'bg-accent-amber/40' : 'bg-accent-amber'"
        [style.width.%]="progress()"
      ></div>
    </div>
  </div>

  <!-- Time -->
  <span class="text-text-muted text-[10px] tabular-nums whitespace-nowrap">
    @if (state() === 'complete') { {{ formattedDuration() }} } @else { {{ formattedTime() }} }
  </span>

  <!-- Speed selector -->
  <button
    type="button"
    class="flex-shrink-0 px-1.5 py-0.5 rounded-lg bg-accent-amber/10 text-accent-amber text-[10px] font-medium cursor-pointer hover:bg-accent-amber/20 transition-colors"
    (click)="cycleSpeed()"
    aria-label="Change playback speed"
  >
    {{ playbackSpeed() }}x
  </button>

  <!-- Download button -->
  <button
    type="button"
    class="flex-shrink-0 w-8 h-8 flex items-center justify-center text-text-muted hover:text-accent-amber cursor-pointer transition-colors"
    (click)="download()"
    aria-label="Download narration"
  >
    <svg
      class="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7,10 12,15 17,10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  </button>
</div>
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx nx test web --testPathPattern=audio-player.component.spec --no-coverage
```

Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/components/audio-player/
git commit -m "feat(m5): implement AudioPlayerComponent with state machine and SVG icons"
```

---

## Task 9: Integrate AudioPlayer into ChatComponent

**Files:**

- Modify: `apps/web/src/app/components/chat/chat.component.ts`
- Modify: `apps/web/src/app/components/chat/chat.component.html`

- [ ] **Step 1: Add AudioPlayerComponent import to ChatComponent**

In `apps/web/src/app/components/chat/chat.component.ts`, add the import:

```typescript
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
```

Add `AudioPlayerComponent` to the `imports` array in the `@Component` decorator:

```typescript
imports: [
  NgTemplateOutlet,
  FormsModule,
  MarkdownComponent,
  AgentStepsComponent,
  SourceCardComponent,
  TrustBarComponent,
  ProviderSelectorComponent,
  MetaBarComponent,
  AudioPlayerComponent,
],
```

Add a computed signal for when the player should be enabled:

```typescript
readonly answerReady = computed(() => !this.loading() && !!this.response()?.answer);
```

- [ ] **Step 2: Add the audio player to the sticky header**

In `apps/web/src/app/components/chat/chat.component.html`, find the sticky header in the results section. Locate the `<div class="flex items-center gap-2">` that contains the "New question" button. Add the audio player before the "New question" button:

```html
<div class="flex items-center gap-2">
  <app-audio-player [text]="enrichedAnswer()" [disabled]="!answerReady()" />
  <button
    type="button"
    class="text-mono text-xs text-text-muted hover:text-text-secondary cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-subtle hover:border-border-default transition-colors"
    (click)="goHome()"
  >
    <!-- New question icon -->
    New question
  </button>
  <ng-container *ngTemplateOutlet="themeToggle" />
</div>
```

- [ ] **Step 3: Verify it compiles**

```bash
npx nx build web
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/components/chat/
git commit -m "feat(m5): integrate AudioPlayerComponent into chat sticky header"
```

---

## Task 10: Manual E2E Verification

- [ ] **Step 1: Start both servers**

```bash
# Terminal 1
npx nx serve api
# Terminal 2
npx nx serve web
```

- [ ] **Step 2: Verify the full flow**

1. Open `http://localhost:4200`
2. Submit a query (e.g., "What does HN think about AI agents?")
3. Wait for the answer to fully load
4. Verify the "Listen" pill appears in the header
5. Click "Listen"
6. Verify loading state shows "Preparing..."
7. Verify audio starts playing (or enters paused state on mobile)
8. Test pause/play toggle
9. Test speed selector cycling
10. Test download button
11. Verify error state + retry works (stop the API mid-request)

- [ ] **Step 3: Run full test suite**

```bash
npx nx affected:test --no-coverage
npx nx affected:lint
```

Expected: All tests pass, no lint errors.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(m5): address issues found during manual verification"
```

---

## Summary

| Task | Description                  | Linear Issue   |
| ---- | ---------------------------- | -------------- |
| 1    | Install SDK + shared types   | AI-126, AI-127 |
| 2    | Narrator prompt              | AI-131         |
| 3    | TtsService (backend)         | AI-129         |
| 4    | TtsController                | AI-130         |
| 5    | TtsModule + AppModule wiring | AI-126         |
| 6    | Frontend proxy config        | AI-127         |
| 7    | Frontend TtsService          | AI-133         |
| 8    | AudioPlayerComponent         | AI-132         |
| 9    | ChatComponent integration    | AI-132         |
| 10   | Manual E2E verification      | AI-126, AI-127 |
