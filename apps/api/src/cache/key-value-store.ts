import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CacheService } from './cache.service';

/** Nest injection token for the {@link KeyValueStore} selected at boot. */
export const KEY_VALUE_STORE = Symbol('KEY_VALUE_STORE');

/** Key prefix so VoxPopuli can share a Redis instance with other apps. */
const REDIS_KEY_PREFIX = 'vp:';

/** Per-command timeout: a slow Redis must never stall a query. */
const REDIS_COMMAND_TIMEOUT_MS = 1000;

/** Connection timeout for the initial connect and each reconnect attempt. */
const REDIS_CONNECT_TIMEOUT_MS = 5000;

/** Repeated Redis errors are logged at most this often. */
const ERROR_LOG_INTERVAL_MS = 30_000;

/**
 * Async key/value storage with per-key TTLs, used by {@link QueryStore} for the
 * records that should outlive a process (completed results, follow-up evidence).
 *
 * Implementations never throw: a failed read resolves to `undefined` (a miss)
 * and a failed write is logged and dropped.
 */
export interface KeyValueStore {
  /**
   * True when values outlive this process (Redis). False for the in-memory store,
   * which shares the process-local LRU with {@link CacheService}, so mirroring into
   * it would only duplicate work.
   */
  readonly durable: boolean;

  /**
   * Read a JSON value.
   *
   * @param key - Storage key
   * @returns The stored value, or `undefined` on a miss or a storage error
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Write a JSON value that expires after `ttlSeconds`.
   *
   * @param key        - Storage key
   * @param value      - JSON-serializable value
   * @param ttlSeconds - Time-to-live in seconds
   */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;

  /**
   * Delete a key.
   *
   * @param key - Storage key
   */
  del(key: string): Promise<void>;
}

/**
 * In-process implementation backed by {@link CacheService}'s LRU. Used when
 * `REDIS_URL` is unset; nothing survives a restart.
 */
export class MemoryKeyValueStore implements KeyValueStore {
  readonly durable = false;

  constructor(private readonly cache: CacheService) {}

  /** @inheritdoc */
  async get<T>(key: string): Promise<T | undefined> {
    return this.cache.get<T>(key);
  }

  /** @inheritdoc */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.cache.set(key, value, ttlSeconds);
  }

  /** @inheritdoc */
  async del(key: string): Promise<void> {
    this.cache.del(key);
  }
}

/** The subset of the ioredis client {@link RedisKeyValueStore} relies on (mockable in tests). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
  quit(): Promise<unknown>;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/**
 * Redis-backed implementation. Values are JSON strings stored with a native
 * `SET ... EX` TTL under the `vp:` prefix.
 *
 * Every failure (Redis down, timeout, bad JSON) degrades to a miss or a dropped
 * write so queries keep working from the in-memory cache.
 */
export class RedisKeyValueStore implements KeyValueStore {
  readonly durable = true;

  private readonly logger = new Logger(RedisKeyValueStore.name);
  private lastErrorLog = 0;

  /**
   * @param client - An ioredis client (or a test double with the same methods)
   */
  constructor(private readonly client: RedisLike) {
    // ioredis emits 'error' on connection failures; without a listener Node
    // treats it as an unhandled error event and crashes the process.
    client.on('error', (err) => this.logError('connection', err));
  }

  /**
   * Build a store from a `redis://` / `rediss://` URL. Commands fail fast while
   * disconnected (no offline queue) and time out after
   * {@link REDIS_COMMAND_TIMEOUT_MS}; the client keeps reconnecting in the background.
   *
   * @param url - Redis connection URL (e.g. Render Key Value's internal URL)
   * @returns A connected-in-background store
   */
  static fromUrl(url: string): RedisKeyValueStore {
    const client = new Redis(url, {
      keyPrefix: REDIS_KEY_PREFIX,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 10_000),
    });
    return new RedisKeyValueStore(client);
  }

  /** @inheritdoc */
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.client.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (err) {
      this.logError(`GET ${key}`, err);
      return undefined;
    }
  }

  /** @inheritdoc */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.ceil(ttlSeconds)));
    } catch (err) {
      this.logError(`SET ${key}`, err);
    }
  }

  /** @inheritdoc */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logError(`DEL ${key}`, err);
    }
  }

  /** Close the connection (called on application shutdown). */
  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // Already disconnected — nothing to close.
    }
  }

  /** Log a Redis failure, throttled so an outage doesn't flood the logs. */
  private logError(op: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog < ERROR_LOG_INTERVAL_MS) return;
    this.lastErrorLog = now;
    // Connection failures can be AggregateErrors with an empty message; fall back to the code.
    const message =
      err instanceof Error
        ? err.message || (err as NodeJS.ErrnoException).code || err.name
        : String(err);
    this.logger.warn(`Redis ${op} failed, falling back to in-memory: ${message}`);
  }
}

/**
 * Pick the store for this process: Redis when `redisUrl` is set, otherwise the
 * in-memory LRU (today's behavior; no Redis needed for local dev or tests).
 *
 * @param redisUrl - Value of the `REDIS_URL` env var, if any
 * @param cache    - The process-local cache used by the in-memory store
 * @returns The selected {@link KeyValueStore}
 */
export function createKeyValueStore(
  redisUrl: string | undefined,
  cache: CacheService,
): KeyValueStore {
  const url = redisUrl?.trim();
  if (!url) return new MemoryKeyValueStore(cache);
  new Logger('KeyValueStore').log('REDIS_URL set — persisting query results to Redis');
  return RedisKeyValueStore.fromUrl(url);
}
