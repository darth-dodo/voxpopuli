/**
 * Central registry of all model identifiers used across the application.
 * Change a model here and it propagates everywhere.
 */

// ── OpenRouter ──
/** OpenRouter's OpenAI-compatible API endpoint (LLM + TTS). */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ── LLM Providers ──
/** OpenRouter model slug (`vendor/model`), see https://openrouter.ai/models */
export const OPENROUTER_MODEL_ID = 'qwen/qwen3-235b-a22b-2507';
export const CLAUDE_MODEL_ID = 'claude-haiku-4-5-20251001';
export const MISTRAL_MODEL_ID = 'mistral-small-latest';

// ── TTS (OpenRouter audio output) ──
/** OpenRouter audio-output model used for narration. */
export const OPENROUTER_TTS_MODEL_ID = 'openai/gpt-audio-mini';
/** Voices documented for OpenRouter audio output. */
export const OPENROUTER_TTS_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
export type OpenRouterTtsVoice = (typeof OPENROUTER_TTS_VOICES)[number];
/** Default narrator voice — deep, calm; closest to the previous ElevenLabs "Brian". */
export const OPENROUTER_TTS_DEFAULT_VOICE: OpenRouterTtsVoice = 'onyx';
