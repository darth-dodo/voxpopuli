import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentResponse, AgentSource } from '@voxpopuli/shared-types';
import { evaluateSourceAccuracy } from '../source-accuracy';

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

function makeResponse(
  sources: AgentSource[],
  overrides: Partial<AgentResponse> = {},
): AgentResponse {
  return {
    answer: 'Test answer',
    steps: [],
    sources,
    meta: {
      provider: 'groq',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      durationMs: 1000,
      cached: false,
    },
    trust: {
      sourcesVerified: sources.length,
      sourcesTotal: sources.length,
      avgSourceAge: 30,
      recentSourceRatio: 0.8,
      viewpointDiversity: 'balanced',
      showHnCount: 0,
      honestyFlags: [],
    },
    ...overrides,
  };
}

describe('evaluateSourceAccuracy', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns score 0 when response is null', async () => {
    const result = await evaluateSourceAccuracy(null);

    expect(result.key).toBe('source_accuracy');
    expect(result.score).toBe(0);
    expect(result.comment).toBeDefined();
  });

  it('returns score 0 when sources array is empty', async () => {
    const response = makeResponse([]);
    const result = await evaluateSourceAccuracy(response);

    expect(result.key).toBe('source_accuracy');
    expect(result.score).toBe(0);
    expect(result.comment).toBeDefined();
  });

  it('returns score 1.0 when all sources verify', async () => {
    const sources = [makeSource({ storyId: 111 }), makeSource({ storyId: 222 })];
    const response = makeResponse(sources);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 111, title: 'A story' }),
      }),
    );

    const result = await evaluateSourceAccuracy(response);

    expect(result.key).toBe('source_accuracy');
    expect(result.score).toBe(1.0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns proportional score for mixed results (e.g. 2/3 = 0.667)', async () => {
    const sources = [
      makeSource({ storyId: 111 }),
      makeSource({ storyId: 222 }),
      makeSource({ storyId: 333 }),
    ];
    const response = makeResponse(sources);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 111, title: 'Story 1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 222, title: 'Story 2' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => null,
        }),
    );

    const result = await evaluateSourceAccuracy(response);

    expect(result.key).toBe('source_accuracy');
    expect(result.score).toBeCloseTo(2 / 3, 2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('returns score 0 when fetch throws/times out for all sources', async () => {
    const sources = [makeSource({ storyId: 111 }), makeSource({ storyId: 222 })];
    const response = makeResponse(sources);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')));

    const result = await evaluateSourceAccuracy(response);

    expect(result.key).toBe('source_accuracy');
    expect(result.score).toBe(0);
  });
});
