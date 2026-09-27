# ADR-008: Mistral Voxtral for Text-to-Speech

**Status:** Accepted
**Date:** 2026-09-27
**Deciders:** Abhishek Juneja
**Supersedes:** The ElevenLabs TTS integration (M5, see product.md §19)

## Context

Voice output ("Listen") rewrites an answer into a podcast script with the active LLM, then sends the script to a TTS service. That service was ElevenLabs, which meant a separate vendor, API key, SDK (`elevenlabs`, now deprecated in favour of `@elevenlabs/elevenlabs-js`) and credit-based billing, just for narration.

Around the same time, the LLM layer moved to OpenRouter (ADR-003 addendum) with the aim of fewer vendors and keys. We wanted TTS to follow and evaluated two replacements.

### Option A: OpenRouter audio output (rejected)

OpenRouter exposes audio output through chat completions (`modalities: ["text", "audio"]`) for `openai/gpt-audio` and `openai/gpt-audio-mini`. We built and unit-tested this, then rejected it:

- **Blocked by Zero Data Retention.** The only host for both models is OpenAI, which is not ZDR-compliant. Our OpenRouter account and workspace enforce ZDR, so every request failed with `404: 0 endpoints ... available matching your guardrail restrictions and data policy`. Using it would have meant weakening a privacy setting for the whole account.
- **Streaming only, raw PCM.** OpenRouter only returns audio over SSE. OpenAI documents only `pcm16` for streamed audio, so the server had to reassemble base64 chunks and add a WAV header. The output is about 48 KB per second of audio (~8.6 MB for a 3-minute narration versus ~1.4 MB as MP3), and the frontend had to change from MP3 to WAV.
- **A conversational model used as TTS.** `gpt-audio` models answer prompts rather than simply reading them, so a system prompt was needed to force word-for-word reading.

### Option B: Mistral Voxtral TTS (chosen)

The existing `MISTRAL_API_KEY` already has access to `voxtral-mini-tts-latest` (Voxtral TTS v1, 2026-03) at `POST https://api.mistral.ai/v1/audio/speech`.

## Decision

Use Mistral Voxtral TTS for narration and remove ElevenLabs.

- `TtsService.synthesize(script, voice?)` makes one non-streaming `fetch` with `{ model, input, voice_id, response_format: 'mp3' }` and decodes the JSON `{ audio_data }` (base64 MP3) into a Buffer.
- The model is `MISTRAL_TTS_MODEL` (default `voxtral-mini-tts-latest`). The voice is `MISTRAL_TTS_VOICE`, defaulting to the preset `en_paul_neutral` ("Paul - Neutral", tagged relaxed/balanced/neutral), the closest match to the calm editorial narrator the product specifies. There are 30 presets (list them with `GET /v1/audio/voices`), and cloned voices are UUIDs.
- The controller rejects malformed `voiceId`s (`/^[A-Za-z0-9_-]{1,64}$/`) with 400. Voxtral errors raise `TtsUpstreamError`, which becomes a 502 carrying Mistral's reason (e.g. `Voice 'x' not found.`).
- The podcast rewrite step, the 2,500-character narration cap, the rate limit, and the buffered `audio/mpeg` response are unchanged, so the frontend is unchanged.
- No SDK: a single `fetch` keeps the dependency surface at zero. `@langchain/mistralai` is for chat only and doesn't cover speech.

## Consequences

**Positive**

- One fewer vendor, key, and dependency. TTS reuses `MISTRAL_API_KEY`, which the default LLM provider already needs.
- Works with ZDR enforcement on OpenRouter, because TTS no longer goes through OpenRouter.
- Output is MP3, about 6× smaller than the WAV Option A produced, so the frontend didn't change.
- Measured: a 2,500-character script (the cap) produces about 108 s of 22.05 kHz mono MP3 (~960 KB) in about 10 s. The full `/api/tts/narrate` round trip, including the LLM rewrite, took 4-15 s in end-to-end tests.
- Voice cloning from 2-3 s samples is available if the project later wants a custom signature voice.

**Negative**

- Not streamed: playback starts only after the full clip is generated (about 10 s at the cap). The endpoint already buffered ElevenLabs output for reverse-proxy compatibility, so user-visible behaviour is similar. Voxtral supports `stream: true` if lower time-to-first-audio is needed later.
- Voice IDs are open-ended (presets plus custom UUIDs), so unknown voices are caught upstream (502) instead of by a local allow-list (400).
- The Voxtral TTS model is released under CC BY-NC 4.0. Hosted API use is governed by Mistral's API terms; check them before any commercial deployment.
- TTS depends on Mistral's availability even when `LLM_PROVIDER` is another provider.
