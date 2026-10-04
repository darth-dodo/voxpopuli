import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { QueryStore } from './query-store';
import { CacheService } from './cache.service';
import { MemoryKeyValueStore, RedisKeyValueStore, type RedisLike } from './key-value-store';
import type {
  AgentResponse,
  AgentStep,
  PriorEvidence,
  StoredPipelineEvent,
} from '@voxpopuli/shared-types';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('QueryStore', () => {
  let store: QueryStore;
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
    store = new QueryStore(cache);
  });

  const mockResponse: AgentResponse = {
    answer: 'Test answer',
    steps: [],
    sources: [],
    meta: {
      provider: 'mistral',
      model: 'test-model',
      tokensUsed: 100,
      latencyMs: 500,
      agentSteps: 3,
    },
    trust: {
      sourceCount: 1,
      avgSourceAge: 5,
      hasConflictingViews: false,
      claimVerification: [],
    },
  };

  const mockEvidence = {
    query: 'What is Rust?',
    bundle: { themes: [] },
    steps: [],
  } as unknown as PriorEvidence;

  const mockStep: AgentStep = {
    type: 'thought',
    content: 'Thinking about the query...',
  };

  const mockEvent: StoredPipelineEvent = {
    stage: 'retriever',
    status: 'running',
    detail: 'Searching HN stories',
    timestamp: Date.now(),
  };

  it('create() stores entry retrievable by get()', () => {
    const queryId = store.create('test query', 'mistral');
    const entry = store.get(queryId);

    expect(entry).toBeDefined();
    expect(entry!.queryId).toBe(queryId);
    expect(entry!.status).toBe('running');
    expect(entry!.response).toBeNull();
    expect(entry!.pipelineEvents).toEqual([]);
    expect(entry!.steps).toEqual([]);
    expect(entry!.error).toBeNull();
    expect(entry!.createdAt).toBeGreaterThan(0);
    expect(entry!.completedAt).toBeNull();
  });

  it('create() returns a UUID v4', () => {
    const queryId = store.create('test query', 'mistral');
    expect(queryId).toMatch(UUID_V4_RE);
  });

  it('appendEvent() adds pipeline events to stored entry', () => {
    const queryId = store.create('test query', 'mistral');

    store.appendEvent(queryId, mockEvent);
    store.appendEvent(queryId, { ...mockEvent, stage: 'synthesizer' });

    const entry = store.get(queryId);
    expect(entry!.pipelineEvents).toHaveLength(2);
    expect(entry!.pipelineEvents[0].stage).toBe('retriever');
    expect(entry!.pipelineEvents[1].stage).toBe('synthesizer');
  });

  it('appendStep() adds agent steps to stored entry', () => {
    const queryId = store.create('test query', 'mistral');

    store.appendStep(queryId, mockStep);
    store.appendStep(queryId, { type: 'action', content: 'search_hn', toolName: 'search_hn' });

    const entry = store.get(queryId);
    expect(entry!.steps).toHaveLength(2);
    expect(entry!.steps[0].type).toBe('thought');
    expect(entry!.steps[1].type).toBe('action');
  });

  it('complete() sets status to complete with response and completedAt', () => {
    const queryId = store.create('test query', 'mistral');

    store.complete(queryId, mockResponse);

    const entry = store.get(queryId);
    expect(entry!.status).toBe('complete');
    expect(entry!.response).toEqual(mockResponse);
    expect(entry!.completedAt).toBeGreaterThan(0);
  });

  it('fail() sets status to error with error message', () => {
    const queryId = store.create('test query', 'mistral');

    store.fail(queryId, 'LLM provider timeout');

    const entry = store.get(queryId);
    expect(entry!.status).toBe('error');
    expect(entry!.error).toBe('LLM provider timeout');
    expect(entry!.completedAt).toBeGreaterThan(0);
  });

  it('get() returns undefined for unknown queryId', () => {
    const entry = store.get('nonexistent-id');
    expect(entry).toBeUndefined();
  });

  it('findRunning() returns queryId for running query', () => {
    const queryId = store.create('test query', 'mistral');

    const found = store.findRunning('test query', 'mistral');
    expect(found).toBe(queryId);
  });

  it('findRunning() returns null for completed query', () => {
    const queryId = store.create('test query', 'mistral');
    store.complete(queryId, mockResponse);

    const found = store.findRunning('test query', 'mistral');
    expect(found).toBeNull();
  });

  it('findRunning() returns null for unknown query', () => {
    const found = store.findRunning('unknown query', 'mistral');
    expect(found).toBeNull();
  });

  describe('findReusable()', () => {
    it('attaches to a running query', async () => {
      const queryId = store.create('test query', 'mistral');
      expect(await store.findReusable('test query', 'mistral')).toEqual({
        queryId,
        complete: false,
      });
    });

    it('replays a completed query, ignoring case and extra whitespace', async () => {
      const queryId = store.create('What does HN think about Rust?', 'mistral');
      store.complete(queryId, mockResponse);

      expect(await store.findReusable('  what does hn think   about rust? ', 'mistral')).toEqual({
        queryId,
        complete: true,
      });
    });

    it('never reuses a failed query', async () => {
      const queryId = store.create('test query', 'mistral');
      store.fail(queryId, 'boom');
      expect(await store.findReusable('test query', 'mistral')).toBeNull();
    });

    it('keys by provider (callers include the pipeline mode in it)', async () => {
      const queryId = store.create('test query', 'mistral:pipeline');
      store.complete(queryId, mockResponse);
      expect(await store.findReusable('test query', 'mistral:legacy')).toBeNull();
    });
  });

  describe('without REDIS_URL (in-memory)', () => {
    it('findResult() and getEvidence() read the process-local cache', async () => {
      const queryId = store.create('test query', 'mistral');
      store.complete(queryId, mockResponse);
      store.setEvidence(queryId, mockEvidence);

      expect((await store.findResult(queryId))!.status).toBe('complete');
      expect(await store.getEvidence(queryId)).toEqual(mockEvidence);
    });

    it('never writes to the in-memory key/value store (it shares the same LRU)', () => {
      const kv = new MemoryKeyValueStore(cache);
      const setSpy = jest.spyOn(kv, 'set');
      const memStore = new QueryStore(cache, kv);

      const queryId = memStore.create('test query', 'mistral');
      memStore.complete(queryId, mockResponse);
      memStore.setEvidence(queryId, mockEvidence);

      expect(setSpy).not.toHaveBeenCalled();
    });

    it('loses everything on restart', async () => {
      const queryId = store.create('test query', 'mistral');
      store.complete(queryId, mockResponse);

      const restarted = new QueryStore(new CacheService());
      expect(await restarted.findResult(queryId)).toBeUndefined();
      expect(await restarted.findReusable('test query', 'mistral')).toBeNull();
    });
  });

  describe('with Redis (mocked client)', () => {
    let redis: FakeRedis;
    let durable: QueryStore;

    /** Let fire-and-forget writes settle. */
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    /** A fresh process: new local cache, same Redis. */
    const restart = () => new QueryStore(new CacheService(), new RedisKeyValueStore(redis));

    beforeEach(() => {
      redis = new FakeRedis();
      durable = new QueryStore(cache, new RedisKeyValueStore(redis));
    });

    afterEach(() => jest.restoreAllMocks());

    it('writes a lightweight running marker and dedup entry on create() with native TTLs', async () => {
      const queryId = durable.create('test query', 'mistral');
      durable.appendStep(queryId, mockStep);
      await flush();

      const marker = JSON.parse(redis.data.get(`query:${queryId}`)!.value);
      expect(marker.status).toBe('running');
      expect(marker.steps).toEqual([]);
      expect(redis.data.get(`query:${queryId}`)!.ttl).toBe(300);
      expect(redis.data.get(`dedup:${dedupHash('test query', 'mistral')}`)).toEqual({
        value: JSON.stringify(queryId),
        ttl: 900,
      });
      // Steps are buffered locally only
      expect(redis.set).toHaveBeenCalledTimes(2);
    });

    it('persists completed results (15 min), failures (5 min) and evidence (30 min)', async () => {
      const ok = durable.create('ok query', 'mistral');
      durable.appendStep(ok, mockStep);
      durable.complete(ok, mockResponse);
      durable.setEvidence(ok, mockEvidence);
      const bad = durable.create('bad query', 'mistral');
      durable.fail(bad, 'boom');
      await flush();

      const stored = JSON.parse(redis.data.get(`query:${ok}`)!.value);
      expect(stored.status).toBe('complete');
      expect(stored.steps).toEqual([mockStep]);
      expect(redis.data.get(`query:${ok}`)!.ttl).toBe(900);
      expect(redis.data.get(`evidence:${ok}`)!.ttl).toBe(1800);
      expect(redis.data.get(`query:${bad}`)!.ttl).toBe(300);
    });

    it('serves results, replays and follow-up evidence after a restart', async () => {
      const queryId = durable.create('What is Rust?', 'mistral:pipeline');
      durable.complete(queryId, mockResponse);
      durable.setEvidence(queryId, mockEvidence);
      await flush();

      const next = restart();
      expect((await next.findResult(queryId))!.response).toEqual(mockResponse);
      expect(await next.getEvidence(queryId)).toEqual(mockEvidence);
      expect(await next.findReusable('what is rust?', 'mistral:pipeline')).toEqual({
        queryId,
        complete: true,
      });
      // Hydrated locally so the synchronous SSE replay path can read it
      expect(next.get(queryId)!.status).toBe('complete');
    });

    it('reports a query running elsewhere as running, but never attaches to it', async () => {
      const queryId = durable.create('test query', 'mistral');
      await flush();

      const other = restart();
      const marker = await other.findResult(queryId);
      expect(marker!.status).toBe('running');
      expect(marker!.pipelineEvents).toEqual([]);
      expect(await other.findReusable('test query', 'mistral')).toBeNull();
    });

    it('does not replay a failed query from Redis', async () => {
      const queryId = durable.create('test query', 'mistral');
      durable.fail(queryId, 'boom');
      await flush();

      expect(await restart().findReusable('test query', 'mistral')).toBeNull();
    });

    it('treats entries past their Redis TTL as gone', async () => {
      const queryId = durable.create('test query', 'mistral');
      durable.complete(queryId, mockResponse);
      await flush();

      redis.advance(901);
      const next = restart();
      expect(await next.findResult(queryId)).toBeUndefined();
      expect(await next.findReusable('test query', 'mistral')).toBeNull();
    });

    it('prefers the local copy and skips Redis on a local hit', async () => {
      const queryId = durable.create('test query', 'mistral');
      durable.complete(queryId, mockResponse);
      await flush();
      redis.get.mockClear();

      expect((await durable.findResult(queryId))!.status).toBe('complete');
      expect(await durable.findReusable('test query', 'mistral')).not.toBeNull();
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('keeps working from memory when Redis is down', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      redis.failing = true;

      const queryId = durable.create('test query', 'mistral');
      durable.complete(queryId, mockResponse);
      durable.setEvidence(queryId, mockEvidence);
      await flush();

      // Local reads still work
      expect((await durable.findResult(queryId))!.status).toBe('complete');
      expect(await durable.findReusable('test query', 'mistral')).toEqual({
        queryId,
        complete: true,
      });
      // Durable misses degrade to "not found" instead of throwing
      const next = restart();
      await expect(next.findResult(queryId)).resolves.toBeUndefined();
      await expect(next.getEvidence(queryId)).resolves.toBeUndefined();
      await expect(next.findReusable('test query', 'mistral')).resolves.toBeNull();
      expect(warn).toHaveBeenCalled();
    });
  });
});

/** Same hash QueryStore uses for its dedup index. */
function dedupHash(query: string, provider: string): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(`${normalized}:${provider}`).digest('hex').slice(0, 16);
}

/** Minimal in-memory stand-in for an ioredis client, honoring `SET ... EX`. */
class FakeRedis implements RedisLike {
  readonly data = new Map<string, { value: string; ttl: number }>();
  private readonly expiresAt = new Map<string, number>();
  private now = 0;
  failing = false;

  readonly get = jest.fn(async (key: string): Promise<string | null> => {
    if (this.failing) throw new Error('ECONNREFUSED');
    const exp = this.expiresAt.get(key);
    if (exp === undefined || exp <= this.now) return null;
    return this.data.get(key)!.value;
  });

  readonly set = jest.fn(async (key: string, value: string, _mode: 'EX', ttl: number) => {
    if (this.failing) throw new Error('ECONNREFUSED');
    this.data.set(key, { value, ttl });
    this.expiresAt.set(key, this.now + ttl);
    return 'OK';
  });

  readonly del = jest.fn(async (key: string) => {
    if (this.failing) throw new Error('ECONNREFUSED');
    this.expiresAt.delete(key);
    return this.data.delete(key) ? 1 : 0;
  });

  readonly quit = jest.fn(async () => 'OK');
  readonly on = jest.fn();

  /** Move the fake clock forward. */
  advance(seconds: number): void {
    this.now += seconds;
  }
}
