/**
 * Central registry of all model identifiers used across the application.
 * Change a model here and it propagates everywhere.
 */

// ── OpenRouter ──
/** OpenRouter's OpenAI-compatible API endpoint. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ── LLM Providers ──
/** OpenRouter model slug (`vendor/model`), see https://openrouter.ai/models */
export const OPENROUTER_MODEL_ID = 'qwen/qwen3-235b-a22b-2507';
export const CLAUDE_MODEL_ID = 'claude-haiku-4-5-20251001';
export const MISTRAL_MODEL_ID = 'mistral-small-latest';

// ── TTS (Mistral Voxtral) ──
/** Mistral API base URL (used directly for text-to-speech). */
export const MISTRAL_API_BASE_URL = 'https://api.mistral.ai/v1';
/** Voxtral text-to-speech model used for narration. */
export const MISTRAL_TTS_MODEL_ID = 'voxtral-mini-tts-latest';
/**
 * Default narrator voice: Voxtral preset "Paul - Neutral" (relaxed, balanced).
 * List presets with `GET https://api.mistral.ai/v1/audio/voices`.
 */
export const MISTRAL_TTS_DEFAULT_VOICE = 'en_paul_neutral';
