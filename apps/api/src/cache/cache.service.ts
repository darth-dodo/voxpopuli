import { Injectable, Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import type { CacheStats } from '@voxpopuli/shared-types';

/** Maximum number of entries in the cache. */
const MAX_ENTRIES = 5000;

/** Cache full warning threshold (percentage). */
const WARNING_THRESHOLD = 0.8;

/** Wrapper so that null values can be stored in the LRU cache (which requires `extends {}`). */
const NULL_SENTINEL = Object.freeze({ __null: true }) as { __null: true };

/**
 * Thin wrapper around `lru-cache` providing typed get/set operations,
 * LRU eviction, and cache statistics for the health endpoint.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  private readonly cache = new LRUCache<string, object | string | number | boolean>({
    max: MAX_ENTRIES,
    allowStale: false,
  });

  private hits = 0;
  private misses = 0;

  /**
   * Return a cached value if present, otherwise call `fetcher`, store
   * the result for `ttlSeconds`, and return it.
   *
   * @param key       - Unique cache key
   * @param fetcher   - Async function that produces the value on a cache miss
   * @param ttlSeconds - Time-to-live in seconds
   * @returns The cached or freshly-fetched value
   */
  async getOrSet<T>(key: string, fetcher: () => Promise<T>, ttlSeconds: number): Promise<T> {
    const raw = this.cache.get(key);
    if (raw !== undefined) {
      this.hits++;
      return this.unwrap<T>(raw);
    }

    this.misses++;
    const value = await fetcher();
    this.cache.set(key, this.wrap(value), { ttl: ttlSeconds * 1000 });
    this.checkCapacity();
    return value;
  }

  /**
   * Store a value in the cache with the given TTL.
   *
   * @param key - Unique cache key
   * @param value - Value to store
   * @param ttlSeconds - Time-to-live in seconds
   */
  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.cache.set(key, this.wrap(value), { ttl: ttlSeconds * 1000 });
    this.checkCapacity();
  }

  /**
   * Retrieve a value from the cache by key.
   *
   * @param key - Cache key to look up
   * @returns The cached value, or `undefined` on a miss
   */
  get<T>(key: string): T | undefined {
    const raw = this.cache.get(key);
    if (raw !== undefined) {
      this.hits++;
      return this.unwrap<T>(raw);
    }
    this.misses++;
    return undefined;
  }

  /**
   * Delete a key from the cache.
   *
   * @param key - Cache key to remove
   */
  del(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Return current cache hit/miss/key statistics.
   *
   * @returns A {@link CacheStats} snapshot
   */
  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      keys: this.cache.size,
    };
  }

  /** Wrap null values so they can be stored in the LRU cache. */
  private wrap(value: unknown): object | string | number | boolean {
    return value === null ? NULL_SENTINEL : (value as object | string | number | boolean);
  }

  /** Unwrap sentinel values back to null. */
  private unwrap<T>(raw: object | string | number | boolean): T {
    return (raw === NULL_SENTINEL ? null : raw) as T;
  }

  /** Log a warning when cache approaches capacity. */
  private checkCapacity(): void {
    const usage = this.cache.size / MAX_ENTRIES;
    if (usage >= WARNING_THRESHOLD) {
      this.logger.warn(
        `Cache at ${Math.round(usage * 100)}% capacity (${this.cache.size}/${MAX_ENTRIES} keys)`,
      );
    }
  }
}
