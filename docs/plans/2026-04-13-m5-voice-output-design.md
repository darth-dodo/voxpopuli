# M5: Voice Output — Design Spec

**Date:** 2026-04-13
**Milestone:** M5: Voice Output
**Linear Issues:** AI-126 through AI-133
**Branch:** `feature/m5-voice-output`

## Overview

Add podcast-style narration to VoxPopuli answers. Users click a "Listen" pill in the answer header to hear the answer narrated by a characterful AI narrator via ElevenLabs TTS. The narrator has a rich editorial persona defined entirely in the system prompt — not a ReAct agent, but a single-turn LLM call with strong voice direction.

## Decisions

| Decision                | Choice                                                      | Rationale                                                                  |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Implementation strategy | Full vertical slice (backend + frontend together)           | M5 demo requires the full "click Listen, hear it" flow                     |
| ElevenLabs integration  | Official `elevenlabs` npm SDK                               | Higher-level API, handles streaming natively                               |
| Caching                 | None                                                        | Keep it simple; add later if usage warrants                                |
| Player placement        | "Listen" pill in sticky header, inline player expands below | Compact, doesn't disrupt answer layout                                     |
| Button visibility       | Only after answer is fully loaded                           | Rewrite needs complete text; avoids partial narration                      |
| Audio delivery          | Chunked Transfer Encoding (streamed MP3)                    | Responsive UX — audio starts playing within 1-2s on desktop                |
| Mobile strategy         | Buffered fallback as primary path                           | Safari iOS doesn't support MediaSource for audio; collect chunks then play |
| Narrator approach       | Rich persona in system prompt, single-turn LLM call         | Character depth without ReAct complexity or latency                        |
| Icons                   | Inline SVGs                                                 | No emoji; match Data Noir amber palette                                    |

## Backend Architecture

### Module Structure

```
apps/api/src/tts/
├── tts.module.ts            # NestJS module, imports LlmModule
├── tts.service.ts           # Core service: rewrite + stream
├── tts.controller.ts        # POST /api/tts/narrate, GET /api/tts/voices
├── tts.service.spec.ts      # Unit tests
├── tts.controller.spec.ts   # Unit tests
└── prompts/
    └── narrator.prompt.ts   # Rich narrator persona prompt
```

### TtsService

```typescript
@Injectable()
class TtsService {
  constructor(private llmService: LlmService, private configService: ConfigService) {}

  /** Full pipeline: rewrite then stream audio */
  async narrate(
    text: string,
    options?: { rewrite?: boolean; voiceId?: string },
  ): Promise<{
    stream: Readable; // Node.js Readable stream (from ElevenLabs SDK)
    characterCount: number;
  }>;

  /** Single-turn LLM call with narrator persona prompt */
  async rewriteForSpeech(text: string): Promise<string>;

  /** ElevenLabs SDK streaming TTS — returns Node.js Readable */
  async streamAudio(script: string, voiceId?: string): Promise<Readable>;
}
```

**rewriteForSpeech:** Uses `LlmService.getModel()` for a single-turn call. The narrator prompt defines VoxPopuli's voice: calm, editorial, opinionated. Fidelity rules enforce no new claims, all attributions preserved. Output capped at 2500 chars. Ends with sign-off: "That's the signal from HN. I'm VoxPopuli."

**streamAudio:** Uses the `elevenlabs` SDK's `textToSpeech.stream()` method. Voice defaults to Brian (`nPczCjzI2devNBz1zQrb`) from env config. Model: `eleven_multilingual_v2`. Voice settings: `stability: 0.65, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true`.

### TtsController

```
POST /api/tts/narrate
  Body: TtsRequest { text: string, rewrite?: boolean, voiceId?: string }
  Response: audio/mpeg (chunked transfer encoding)
  Headers: X-TTS-Characters (script length for cost tracking)
  Rate limit: shared 60 req/min with RAG endpoints

GET /api/tts/voices
  Response: { id: string, name: string, model: string, settings: VoiceSettings }
```

The controller pipes the ReadableStream from TtsService directly to the response — no buffering. Sets `Content-Type: audio/mpeg`, `Transfer-Encoding: chunked`, `X-Accel-Buffering: no`, and `Cache-Control: no-cache`.

### Narrator Prompt (narrator.prompt.ts)

The prompt defines VoxPopuli's narrator character:

- **Voice:** Calm, editorial, slightly opinionated — like a tech-savvy NPR host
- **Structure:** Opening hook that captures the core tension → body that walks through the key points → sign-off
- **Fidelity rules:** No new claims beyond what the answer contains. Preserve all attributions and source references. Convert markdown citations to spoken form (e.g., "swyx (340 points)" becomes "swyx, with over 340 points")
- **Voice direction:** Include pacing cues where helpful — pauses, emphasis
- **Constraints:** Output must be under 2500 characters. Strip all markdown formatting.
- **Sign-off:** Always end with "That's the signal from HN. I'm VoxPopuli."

## Frontend Architecture

### Components

```
apps/web/src/app/components/audio-player/
├── audio-player.component.ts       # Standalone component
├── audio-player.component.html     # Template
└── audio-player.component.spec.ts  # Unit tests

apps/web/src/app/services/
└── tts.service.ts                  # Frontend TTS service
```

### AudioPlayerComponent

**Standalone component** placed inside the sticky header of the results view, next to the query text.

**Inputs:**

- `text: string` — the answer content to narrate
- `disabled: boolean` — true while answer is still streaming

**State machine:**

```
idle ──click──▶ loading ──ready──▶ playing ──pause──▶ paused
                   │                  │                  │
                   │ error            │ ended            │ play
                   ▼                  ▼                  ▼
                 error             complete           playing
                   │                  │
                   │ retry            │ replay
                   ▼                  ▼
                loading             playing
```

**States:**

| State    | UI                                                                                        | Controls                                     |
| -------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| idle     | Amber "Listen" pill with microphone SVG icon                                              | Click to start                               |
| loading  | Pill shows spinner + "Preparing..."                                                       | None (or cancel)                             |
| playing  | Inline player expands: pause button, progress bar, elapsed time, speed selector, download | Pause, seek (when buffered), speed, download |
| paused   | Same as playing but with play button, dimmed progress                                     | Play, seek, speed, download                  |
| complete | Replay button, full progress bar, total duration                                          | Replay, download                             |
| error    | Error message with retry button                                                           | Retry                                        |

**Controls (all SVG icons, 44px minimum touch target):**

- Play/Pause toggle (circle button)
- Progress bar (seekable once audio is fully buffered)
- Elapsed time display
- Speed selector: cycles through 0.75x → 1x → 1.25x → 1.5x on tap
- Download button (saves MP3 to device)
- Replay button (in complete state)

### TtsService (Frontend)

```typescript
@Injectable({ providedIn: 'root' })
class TtsService {
  /** Fetch narrated audio as chunked stream, return collected Blob */
  narrate(text: string): Observable<TtsResult>;
}

interface TtsResult {
  blob: Blob; // Complete audio blob (for <audio> and download)
  characterCount: number; // From X-TTS-Characters header
}
```

**Implementation approach (mobile-first):**

1. `fetch('/api/tts/narrate', { method: 'POST', body })` with chunked response
2. Read chunks via `response.body.getReader()` in a loop
3. Collect all chunks into an array
4. **Desktop progressive enhancement:** If `MediaSource.isTypeSupported('audio/mpeg')`, feed chunks to a SourceBuffer for streaming playback (audio starts within 1-2s)
5. **Mobile / fallback:** Buffer all chunks, create Blob URL when stream ends, set as `<audio>` src
6. On complete: combine chunks into final Blob for download functionality
7. Cleanup: revoke object URLs on component destroy

### Integration with ChatComponent

- `AudioPlayerComponent` is rendered inside the sticky header `<div>` in `chat.component.html`
- The `disabled` input is bound to the streaming state — Listen pill only activates after `isLoading() === false && answer()`
- The `text` input receives the full answer markdown string

## Data Flow

```
User clicks "Listen" pill
  │
  ▼
AudioPlayerComponent.onListen()
  │  state → loading
  │
  ▼
TtsService.narrate(answerText)
  │  fetch POST /api/tts/narrate { text, rewrite: true }
  │
  ▼
TtsController.narrate()
  │  validate DTO
  │  enforceRateLimit (shared 60 req/min)
  │
  ▼
TtsService.rewriteForSpeech(text)
  │  LlmService.getModel() → single-turn narrator call (~2s)
  │  Returns podcast script (≤2500 chars)
  │
  ▼
TtsService.streamAudio(script)
  │  ElevenLabs SDK textToSpeech.stream()
  │  Set response header X-TTS-Characters
  │  Pipe chunked MP3 to response
  │
  ▼
Frontend receives chunks
  │  Desktop: MediaSource + SourceBuffer → audio.play() on first chunk
  │  Mobile: buffer chunks → Blob URL → audio.play() when complete
  │  state → playing
  │
  ▼
Stream ends
  │  Combine chunks → Blob (for download)
  │  state → complete (when playback finishes)
```

## Error Handling

| Error                     | Source                  | HTTP                | Frontend Handling                                                  |
| ------------------------- | ----------------------- | ------------------- | ------------------------------------------------------------------ |
| Empty/invalid text        | Controller validation   | 400                 | Button should not appear for empty answers                         |
| Rate limit exceeded       | Controller rate limiter | 429                 | "Too many requests, try again shortly" → error state with retry    |
| LLM rewrite fails         | TtsService              | 500                 | "Narration failed" → error state with retry button                 |
| ElevenLabs API down       | TtsService              | 502                 | "Narration unavailable" → error state with retry                   |
| Stream drops mid-transfer | Network                 | Incomplete response | Detect via reader.done without full content → error with retry     |
| MediaSource unsupported   | Frontend                | N/A                 | Silent fallback to buffered approach (no user-visible difference)  |
| Autoplay blocked (mobile) | Browser policy          | N/A                 | Keep play button in loading state; user taps play when audio ready |

## Mobile Considerations

- **Safari iOS:** No MediaSource support for audio. Always uses buffered fallback (collect all chunks → Blob URL → play). Loading state lasts the full generation time (~5-8s).
- **Autoplay:** `audio.play()` must originate from a user gesture. The Listen click initiates fetch, but if audio isn't ready when the gesture context expires, the play button remains visible for a second tap.
- **Touch targets:** All controls minimum 44px (Apple HIG). Play/pause circle, speed selector, download icon.
- **Layout:** Player inline below sticky header works on 320px+ width. Progress bar is fluid. Speed selector and download are fixed-width.
- **Background tabs:** If the user backgrounds the tab while audio is loading, the fetch continues. Audio plays when the tab is foregrounded (or on next user interaction if autoplay is blocked).

## Testing Strategy

| Layer                      | Scope                                                                   | Approach                                                     |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| TtsService (backend) unit  | Rewrite output format, char limit, sign-off, streamAudio returns buffer | Mock LlmService + ElevenLabs SDK                             |
| TtsController unit         | DTO validation, rate limiting, response headers, error codes            | Mock TtsService                                              |
| Narrator prompt quality    | No new claims, attributions preserved, under 2500 chars                 | Feed known answer text, verify output against fidelity rules |
| TtsService (frontend) unit | Fetch + chunk collection + Blob creation                                | Mock fetch with canned ReadableStream                        |
| AudioPlayerComponent unit  | State machine transitions, control interactions, SVG icon rendering     | Mock TtsService, verify state flow                           |
| E2E (Playwright)           | Full flow: query → answer → Listen → audio element present              | Real backend, mocked ElevenLabs (return canned MP3)          |

All tests mock external APIs (ElevenLabs, LLM providers). No real API calls in tests.

## Shared Types

Already defined in `@voxpopuli/shared-types`:

- `TtsRequest: { text: string; rewrite?: boolean; voiceId?: string }`
- `RewriteTrustMetadata: { factPreservation: number; attributionsRetained: number; toneAlignment: number }`

To add:

- `VoiceConfig: { id: string; name: string; model: string; settings: VoiceSettings }`
- `VoiceSettings: { stability: number; similarityBoost: number; style: number; useSpeakerBoost: boolean }`

## Environment Variables

Already configured in `.env.example` and `env.validation.ts`:

- `ELEVENLABS_API_KEY` (required for TTS)
- `ELEVENLABS_VOICE_ID` (default: `nPczCjzI2devNBz1zQrb` — Brian)
- `ELEVENLABS_MODEL` (default: `eleven_multilingual_v2`)

## Constraints

| Constraint           | Value                                       |
| -------------------- | ------------------------------------------- |
| TTS max chars        | 2500                                        |
| Rate limit           | 60 req/min (shared with RAG)                |
| Voice default        | Brian (`nPczCjzI2devNBz1zQrb`)              |
| Voice model          | `eleven_multilingual_v2`                    |
| Touch target minimum | 44px                                        |
| Min supported width  | 320px                                       |
| Narrator sign-off    | "That's the signal from HN. I'm VoxPopuli." |
