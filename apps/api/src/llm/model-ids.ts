/**
 * Central registry of all model identifiers used across the application.
 * Change a model here and it propagates everywhere.
 */

// ── LLM Providers ──
/** OpenRouter model slug (`vendor/model`), see https://openrouter.ai/models */
export const OPENROUTER_MODEL_ID = 'qwen/qwen3-235b-a22b-2507';
export const CLAUDE_MODEL_ID = 'claude-haiku-4-5-20251001';
export const MISTRAL_MODEL_ID = 'mistral-small-latest';

// ── ElevenLabs TTS ──
export const ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5';
export const ELEVENLABS_DEFAULT_VOICE_ID = 'nPczCjzI2devNBz1zQrb';
