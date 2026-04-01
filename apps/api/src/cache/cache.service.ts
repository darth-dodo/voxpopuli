import { Injectable } from '@nestjs/common';
import NodeCache from 'node-cache';
import type { CacheStats } from '@voxpopuli/shared-types';

/**
 * Thin wrapper around `node-cache` providing typed get/set operations
 * and cache statistics for the health endpoint.
 */
@Injectable()
export class CacheService {
  private readonly cache = new NodeCache({ checkperiod: 120 });

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
    const cached = this.cache.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fetcher();
    this.cache.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Retrieve a value from the cache by key.
   *
   * @param key - Cache key to look up
   * @returns The cached value, or `undefined` on a miss
   */
  get<T>(key: string): T | undefined {
    return this.cache.get<T>(key);
  }

  /**
   * Delete a key from the cache.
   *
   * @param key - Cache key to remove
   */
  del(key: string): void {
    this.cache.del(key);
  }

  /**
   * Return current cache hit/miss/key statistics.
   *
   * @returns A {@link CacheStats} snapshot
   */
  getStats(): CacheStats {
    const stats = this.cache.getStats();
    return {
      hits: stats.hits,
      misses: stats.misses,
      keys: this.cache.keys().length,
    };
  }
}
