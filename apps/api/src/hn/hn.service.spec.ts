import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { HnService } from './hn.service';
import { CacheService } from '../cache/cache.service';
import type { HnSearchResult, HnStory, HnComment } from '@voxpopuli/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal AxiosResponse wrapper for mocked HTTP calls. */
function axiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} } as unknown as InternalAxiosRequestConfig,
  };
}

/** Factory for a fake HN search result. */
function fakeSearchResult(query: string): HnSearchResult {
  return {
    hits: [
      {
        objectID: '1',
        title: `Result for ${query}`,
        url: 'https://example.com',
        author: 'testuser',
        points: 100,
        num_comments: 5,
        created_at: '2025-01-01T00:00:00.000Z',
        story_text: null,
      },
    ],
    nbHits: 1,
    page: 0,
    nbPages: 1,
    hitsPerPage: 10,
  };
}

/** Factory for a fake story item from Firebase. */
function fakeStory(overrides: Partial<HnStory> = {}): HnStory {
  return {
    id: 100,
    type: 'story',
    by: 'pg',
    time: 1700000000,
    title: 'Test Story',
    url: 'https://example.com',
    score: 200,
    descendants: 10,
    kids: [201, 202, 203],
    ...overrides,
  };
}

/** Factory for a fake comment item from Firebase (raw, no depth). */
function fakeFirebaseComment(
  id: number,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    type: 'comment',
    by: `user_${id}`,
    time: 1700000000 + id,
    text: `Comment ${id}`,
    parent: 100,
    kids: [],
    deleted: false,
    dead: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HnService', () => {
  let service: HnService;
  let httpService: HttpService;
  let cacheService: CacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HnService,
        CacheService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<HnService>(HnService);
    httpService = module.get<HttpService>(HttpService);
    cacheService = module.get<CacheService>(CacheService);
  });

  afterEach(() => {
    // Clear cache between tests to avoid cross-contamination
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. search() returns typed HnSearchResult
  // -------------------------------------------------------------------------
  it('search() returns typed HnSearchResult', async () => {
    const expected = fakeSearchResult('rust');
    jest.spyOn(httpService, 'get').mockReturnValue(of(axiosResponse(expected)));

    const result = await service.search('rust');

    expect(result).toEqual(expected);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].title).toBe('Result for rust');
    expect(result.hitsPerPage).toBe(10);
  });

  // -------------------------------------------------------------------------
  // 2. search() results are cached (second call doesn't hit HTTP)
  // -------------------------------------------------------------------------
  it('search() results are cached on second call', async () => {
    const expected = fakeSearchResult('cache-test');
    const getSpy = jest.spyOn(httpService, 'get').mockReturnValue(of(axiosResponse(expected)));

    const first = await service.search('cache-test');
    const second = await service.search('cache-test');

    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    // HTTP should only be called once -- second call hits cache
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 3. getItem() returns typed data
  // -------------------------------------------------------------------------
  it('getItem() returns typed data', async () => {
    const story = fakeStory({ id: 42 });
    jest.spyOn(httpService, 'get').mockReturnValue(of(axiosResponse(story)));

    const result = await service.getItem(42);

    expect(result).toEqual(story);
    expect(result.id).toBe(42);
  });

  // -------------------------------------------------------------------------
  // 4. getItem() is cached
  // -------------------------------------------------------------------------
  it('getItem() is cached on second call', async () => {
    const story = fakeStory({ id: 55 });
    const getSpy = jest.spyOn(httpService, 'get').mockReturnValue(of(axiosResponse(story)));

    await service.getItem(55);
    await service.getItem(55);

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 5. getCommentTree() returns max 30 comments
  // -------------------------------------------------------------------------
  it('getCommentTree() returns max 30 comments', async () => {
    // Story with 15 top-level kids, each having 3 replies
    const kidIds = Array.from({ length: 15 }, (_, i) => 300 + i);
    const story = fakeStory({ id: 100, kids: kidIds });

    const getSpy = jest.spyOn(httpService, 'get');

    // Mock story fetch
    getSpy.mockImplementation((url: string) => {
      if (url.includes('/item/100.json')) {
        return of(axiosResponse(story));
      }

      // Parse item ID from URL
      const match = url.match(/\/item\/(\d+)\.json/);
      if (match) {
        const id = parseInt(match[1], 10);

        // Top-level comments (300-314) each have 3 reply kids
        if (id >= 300 && id < 315) {
          const replyKids = [id * 10 + 1, id * 10 + 2, id * 10 + 3];
          return of(axiosResponse(fakeFirebaseComment(id, { kids: replyKids })));
        }

        // Reply comments
        return of(axiosResponse(fakeFirebaseComment(id, { kids: [] })));
      }

      return of(axiosResponse(null));
    });

    const comments = await service.getCommentTree(100);

    expect(comments.length).toBeLessThanOrEqual(30);
  });

  // -------------------------------------------------------------------------
  // 6. getCommentTree() skips deleted comments
  // -------------------------------------------------------------------------
  it('getCommentTree() skips deleted comments', async () => {
    const story = fakeStory({ id: 100, kids: [401, 402, 403] });

    jest.spyOn(httpService, 'get').mockImplementation((url: string) => {
      if (url.includes('/item/100.json')) {
        return of(axiosResponse(story));
      }
      if (url.includes('/item/401.json')) {
        return of(axiosResponse(fakeFirebaseComment(401, { deleted: true, kids: [] })));
      }
      if (url.includes('/item/402.json')) {
        return of(axiosResponse(fakeFirebaseComment(402, { dead: true, kids: [] })));
      }
      if (url.includes('/item/403.json')) {
        return of(axiosResponse(fakeFirebaseComment(403, { kids: [] })));
      }
      return of(axiosResponse(null));
    });

    const comments = await service.getCommentTree(100);

    // Only comment 403 should survive -- 401 is deleted, 402 is dead
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe(403);
  });

  // -------------------------------------------------------------------------
  // 7. getCommentTree() assigns correct depth values
  // -------------------------------------------------------------------------
  it('getCommentTree() assigns correct depth values', async () => {
    const story = fakeStory({ id: 100, kids: [501] });

    jest.spyOn(httpService, 'get').mockImplementation((url: string) => {
      if (url.includes('/item/100.json')) {
        return of(axiosResponse(story));
      }
      if (url.includes('/item/501.json')) {
        return of(axiosResponse(fakeFirebaseComment(501, { kids: [502] })));
      }
      if (url.includes('/item/502.json')) {
        return of(axiosResponse(fakeFirebaseComment(502, { kids: [503] })));
      }
      if (url.includes('/item/503.json')) {
        return of(axiosResponse(fakeFirebaseComment(503, { kids: [] })));
      }
      return of(axiosResponse(null));
    });

    const comments = await service.getCommentTree(100);

    expect(comments).toHaveLength(3);

    const byId = (id: number): HnComment | undefined => comments.find((c) => c.id === id);

    expect(byId(501)?.depth).toBe(0);
    expect(byId(502)?.depth).toBe(1);
    expect(byId(503)?.depth).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 8. Retry: search() succeeds after transient 500 error
  // -------------------------------------------------------------------------
  it('search() retries and succeeds after a transient 500 error', async () => {
    jest.useFakeTimers();

    const expected = fakeSearchResult('retry-test');
    const error500 = new AxiosError(
      'Internal Server Error',
      'ERR_BAD_RESPONSE',
      undefined,
      undefined,
      {
        status: 500,
        data: null,
        statusText: 'Internal Server Error',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      },
    );

    let callCount = 0;
    jest.spyOn(httpService, 'get').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return throwError(() => error500);
      }
      return of(axiosResponse(expected));
    });

    const resultPromise = service.search('retry-test');

    // Advance past the backoff delay for first retry (200ms + up to 100ms jitter)
    await jest.advanceTimersByTimeAsync(400);

    const result = await resultPromise;
    expect(result).toEqual(expected);
    expect(callCount).toBe(2);

    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 9. Retry: fetchFirebaseItem returns null after all retries exhausted
  // -------------------------------------------------------------------------
  it('fetchFirebaseItem returns null when all retries are exhausted', async () => {
    jest.useFakeTimers();

    const errorTimeout = new AxiosError('Timeout', 'ETIMEDOUT', undefined, undefined, undefined);

    const getSpy = jest.spyOn(httpService, 'get').mockImplementation((url: string) => {
      // Story fetch for getItem succeeds
      if (url.includes('/item/100.json')) {
        return of(axiosResponse(fakeStory({ id: 100, kids: [999] })));
      }
      // Comment fetch always fails
      return throwError(() => errorTimeout);
    });

    const commentsPromise = service.getCommentTree(100);

    // Advance past all retry backoff delays (200ms + 800ms + buffer)
    await jest.advanceTimersByTimeAsync(2000);

    const comments = await commentsPromise;

    // All retries exhausted -> fetchFirebaseItem returns null -> comment skipped
    expect(comments).toHaveLength(0);

    // The story fetch (1 call) + 3 attempts for comment 999
    const commentCalls = getSpy.mock.calls.filter(([url]: [string]) =>
      url.includes('/item/999.json'),
    );
    expect(commentCalls).toHaveLength(3);

    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 10. Retry: no retry on 4xx client errors
  // -------------------------------------------------------------------------
  it('search() does not retry on 4xx client errors', async () => {
    const error404 = new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 404,
      data: null,
      statusText: 'Not Found',
      headers: {},
      config: {} as InternalAxiosRequestConfig,
    });

    const getSpy = jest.spyOn(httpService, 'get').mockImplementation(() => {
      return throwError(() => error404);
    });

    await expect(service.search('no-retry-test')).rejects.toThrow(AxiosError);
    // Should only be called once -- no retry on 4xx
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
