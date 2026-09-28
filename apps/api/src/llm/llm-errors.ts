/** Environment variable that holds each provider's API key. */
export const PROVIDER_KEY_ENV: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  groq: 'OPENROUTER_API_KEY', // deprecated alias for openrouter
};

/**
 * Auth phrases, or a 401/403 in a status position (`401 {...}` at the start, or
 * `Status 401` / `status code: 403`) — a bare number elsewhere could be a story ID.
 */
const AUTH_MESSAGE_PATTERN =
  /invalid[_ ]api[_ ]key|incorrect api key|no auth credentials|authentication[_ ]error|unauthori[sz]ed|^\s*40[13]\b|status(?: code)?:?\s*40[13]\b/i;

/**
 * True when an LLM call failed because the provider rejected our credentials.
 *
 * LangChain wraps each vendor SDK differently: OpenAI/Anthropic errors carry a
 * numeric `status`, Mistral's carry `statusCode`, and some only embed the
 * upstream body in `message` (e.g. `401 {"error":{"code":"invalid_api_key"}}`).
 */
export function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { status?: number; statusCode?: number; response?: { status?: number } };
  const status = e.status ?? e.statusCode ?? e.response?.status;
  if (status === 401 || status === 403) return true;
  return AUTH_MESSAGE_PATTERN.test(e.message);
}

/**
 * Error raised when a provider rejects its API key. Retrying or falling back to
 * another agent on the same provider cannot succeed, so callers should surface
 * this immediately.
 */
export class LlmAuthError extends Error {
  constructor(readonly provider: string) {
    super(
      `The ${provider} API key was rejected. Check ${
        PROVIDER_KEY_ENV[provider] ?? 'the provider API key'
      } in the server environment.`,
    );
    this.name = 'LlmAuthError';
  }
}

/**
 * Retry policy for LLM calls, in the shape AsyncCaller expects: throwing stops retries. Throwing stops retries.
 *
 * Client errors are final: retrying a rejected key or a bad request only adds
 * minutes of backoff. Rate limits (429), timeouts (408) and 5xx are retried.
 */
export function failFastOnClientError(error: unknown): void {
  if (isAuthError(error)) throw error;
  const e = error as { name?: string; status?: number; statusCode?: number };
  if (e.name === 'AbortError') throw error;
  const status = e.status ?? e.statusCode;
  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) throw error;
}
