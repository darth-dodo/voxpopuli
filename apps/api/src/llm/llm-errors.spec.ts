import { failFastOnClientError, isAuthError, LlmAuthError } from './llm-errors';

describe('isAuthError', () => {
  it.each([
    ['numeric status (OpenAI/Anthropic SDKs)', Object.assign(new Error('x'), { status: 401 })],
    ['statusCode (Mistral SDK)', Object.assign(new Error('x'), { statusCode: 403 })],
    ['axios-style response', Object.assign(new Error('x'), { response: { status: 401 } })],
    ['upstream body in message', new Error('401 {"error":{"code":"invalid_api_key"}}')],
    ['Mistral message', new Error('API error occurred: Status 401\nUnauthorized')],
    ['OpenRouter message', new Error('No auth credentials found')],
  ])('detects %s', (_label, err) => {
    expect(isAuthError(err)).toBe(true);
  });

  it.each([
    ['rate limit', Object.assign(new Error('Rate limit exceeded'), { status: 429 })],
    ['server error', new Error('500 Internal Server Error')],
    ['a story ID that happens to be 401', new Error('No story found with ID 401.')],
    ['non-errors', 'Invalid API key'],
  ])('ignores %s', (_label, err) => {
    expect(isAuthError(err)).toBe(false);
  });
});

describe('LlmAuthError', () => {
  it('names the env var to fix, including for the groq alias', () => {
    expect(new LlmAuthError('mistral').message).toContain('MISTRAL_API_KEY');
    expect(new LlmAuthError('groq').message).toContain('OPENROUTER_API_KEY');
  });
});

describe('failFastOnClientError', () => {
  /** Throwing from the handler means "stop retrying". */
  const stopsRetrying = (err: unknown) => {
    try {
      failFastOnClientError(err);
      return false;
    } catch {
      return true;
    }
  };

  it('stops on a rejected API key (Mistral SDK reports statusCode, not status)', () => {
    const sdkError = Object.assign(new Error('API error occurred: Status 401'), {
      statusCode: 401,
    });
    expect(stopsRetrying(sdkError)).toBe(true);
  });

  it('stops on other client errors and aborts', () => {
    expect(stopsRetrying(Object.assign(new Error('bad'), { statusCode: 422 }))).toBe(true);
    expect(stopsRetrying(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
  });

  it('keeps retrying rate limits, timeouts, server errors and network failures', () => {
    expect(stopsRetrying(Object.assign(new Error('slow down'), { statusCode: 429 }))).toBe(false);
    expect(stopsRetrying(Object.assign(new Error('timeout'), { statusCode: 408 }))).toBe(false);
    expect(stopsRetrying(Object.assign(new Error('oops'), { statusCode: 503 }))).toBe(false);
    expect(stopsRetrying(new Error('socket hang up'))).toBe(false);
  });
});
