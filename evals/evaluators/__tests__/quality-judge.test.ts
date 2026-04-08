import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentResponse, AgentSource } from '@voxpopuli/shared-types';
import { evaluateQualityChecklist } from '../quality-judge';

function makeSource(overrides: Partial<AgentSource> = {}): AgentSource {
  return {
    storyId: 12345,
    title: 'Test Story',
    url: 'https://example.com',
    author: 'testuser',
    points: 100,
    commentCount: 50,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    answer: 'Rust and Go are both popular on HN. Story #123 discusses Rust adoption.',
    steps: [],
    sources: [makeSource()],
    meta: {
      provider: 'groq',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      durationMs: 1000,
      cached: false,
    },
    trust: {
      sourcesVerified: 1,
      sourcesTotal: 1,
      avgSourceAge: 30,
      recentSourceRatio: 0.8,
      viewpointDiversity: 'balanced',
      showHnCount: 0,
      honestyFlags: [],
    },
    ...overrides,
  };
}

function mockMistralResponse(verdicts: Array<{ quality: string; verdict: 'PRESENT' | 'ABSENT' }>) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(verdicts),
          },
        },
      ],
    }),
  };
}

describe('evaluateQualityChecklist', () => {
  let originalFetch: typeof globalThis.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env = { ...originalEnv, MISTRAL_API_KEY: 'test-key-123' };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns score 0 when response is null', async () => {
    const result = await evaluateQualityChecklist(null, ['mentions_both_languages']);

    expect(result.key).toBe('quality_checklist');
    expect(result.score).toBe(0);
  });

  it('returns score 0 when expectedQualities is empty', async () => {
    const response = makeResponse();
    const result = await evaluateQualityChecklist(response, []);

    expect(result.key).toBe('quality_checklist');
    expect(result.score).toBe(0);
  });

  it('returns score 0 with comment when MISTRAL_API_KEY is not set', async () => {
    delete process.env.MISTRAL_API_KEY;

    const response = makeResponse();
    const result = await evaluateQualityChecklist(response, ['mentions_both_languages']);

    expect(result.key).toBe('quality_checklist');
    expect(result.score).toBe(0);
    expect(result.comment).toBe('No MISTRAL_API_KEY configured');
  });

  it('returns score 1.0 when all qualities are PRESENT', async () => {
    const qualities = ['mentions_both_languages', 'cites_specific_stories'];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockMistralResponse([
          { quality: 'mentions_both_languages', verdict: 'PRESENT' },
          { quality: 'cites_specific_stories', verdict: 'PRESENT' },
        ]),
      ),
    );

    const response = makeResponse();
    const result = await evaluateQualityChecklist(response, qualities);

    expect(result.key).toBe('quality_checklist');
    expect(result.score).toBe(1.0);
    expect(result.comment).toContain('2/2');
    expect(fetch).toHaveBeenCalledTimes(1);

    // Verify the API call was made correctly
    const callArgs = vi.mocked(fetch).mock.calls[0];
    expect(callArgs[0]).toBe('https://api.mistral.ai/v1/chat/completions');
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body.model).toBe('mistral-large-latest');
    expect(body.temperature).toBe(0);
  });

  it('returns proportional score for mixed verdicts (e.g., 2/4 = 0.5)', async () => {
    const qualities = [
      'mentions_both_languages',
      'cites_specific_stories',
      'compares_community_sentiment',
      'mentions_recent_trends',
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockMistralResponse([
          { quality: 'mentions_both_languages', verdict: 'PRESENT' },
          { quality: 'cites_specific_stories', verdict: 'ABSENT' },
          { quality: 'compares_community_sentiment', verdict: 'PRESENT' },
          { quality: 'mentions_recent_trends', verdict: 'ABSENT' },
        ]),
      ),
    );

    const response = makeResponse();
    const result = await evaluateQualityChecklist(response, qualities);

    expect(result.key).toBe('quality_checklist');
    expect(result.score).toBe(0.5);
    expect(result.comment).toContain('2/4');
  });

  it('returns score 0 when API returns unparseable response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'This is not valid JSON at all',
              },
            },
          ],
        }),
      }),
    );

    const response = makeResponse();
    const result = await evaluateQualityChecklist(response, ['mentions_both_languages']);

    expect(result.key).toBe('quality_checklist');
    expect(result.score).toBe(0);
    expect(result.comment).toContain('Failed to parse');
  });
});
