import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CacheService],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  // -------------------------------------------------------------------------
  // getOrSet
  // -------------------------------------------------------------------------

  describe('getOrSet', () => {
    it('should call fetcher on cache miss and return the value', async () => {
      const fetcher = jest.fn().mockResolvedValue({ answer: 'hello' });

      const result = await service.getOrSet('key1', fetcher, 60);

      expect(result).toEqual({ answer: 'hello' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('should return cached value on cache hit without calling fetcher', async () => {
      const fetcher1 = jest.fn().mockResolvedValue('first');
      const fetcher2 = jest.fn().mockResolvedValue('second');

      await service.getOrSet('key1', fetcher1, 60);
      const result = await service.getOrSet('key1', fetcher2, 60);

      expect(result).toBe('first');
      expect(fetcher2).not.toHaveBeenCalled();
    });

    it('should handle null values via sentinel wrapping', async () => {
      const fetcher = jest.fn().mockResolvedValue(null);

      const result = await service.getOrSet<null>('null-key', fetcher, 60);

      expect(result).toBeNull();

      // Second call should return cached null without calling fetcher
      const fetcher2 = jest.fn().mockResolvedValue('not null');
      const result2 = await service.getOrSet('null-key', fetcher2, 60);

      expect(result2).toBeNull();
      expect(fetcher2).not.toHaveBeenCalled();
    });

    it('should track hits and misses correctly', async () => {
      const fetcher = jest.fn().mockResolvedValue('value');

      // Miss
      await service.getOrSet('k', fetcher, 60);
      // Hit
      await service.getOrSet('k', fetcher, 60);
      // Hit
      await service.getOrSet('k', fetcher, 60);

      const stats = service.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('should return undefined on cache miss', () => {
      const result = service.get('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should return cached value on hit', async () => {
      await service.getOrSet('mykey', async () => 'myvalue', 60);

      const result = service.get<string>('mykey');

      expect(result).toBe('myvalue');
    });

    it('should track hit/miss for get calls', async () => {
      // Miss via get
      service.get('nope');
      // Populate
      await service.getOrSet('exists', async () => 42, 60);
      // Hit via get
      service.get('exists');

      const stats = service.getStats();
      // 1 miss from get('nope') + 1 miss from getOrSet('exists')
      expect(stats.misses).toBe(2);
      // 1 hit from get('exists')
      expect(stats.hits).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // del
  // -------------------------------------------------------------------------

  describe('del', () => {
    it('should remove a cached key', async () => {
      await service.getOrSet('to-delete', async () => 'value', 60);

      service.del('to-delete');

      const result = service.get('to-delete');
      expect(result).toBeUndefined();
    });

    it('should not throw when deleting a nonexistent key', () => {
      expect(() => service.del('nonexistent')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe('getStats', () => {
    it('should return initial stats with zero values', () => {
      const stats = service.getStats();

      expect(stats).toEqual({ hits: 0, misses: 0, keys: 0 });
    });

    it('should reflect correct key count after insertions', async () => {
      await service.getOrSet('a', async () => 1, 60);
      await service.getOrSet('b', async () => 2, 60);

      const stats = service.getStats();

      expect(stats.keys).toBe(2);
    });

    it('should reflect correct key count after deletion', async () => {
      await service.getOrSet('a', async () => 1, 60);
      await service.getOrSet('b', async () => 2, 60);
      service.del('a');

      const stats = service.getStats();

      expect(stats.keys).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Capacity warning
  // -------------------------------------------------------------------------

  describe('capacity warning', () => {
    it('should log a warning when cache reaches 80% capacity', async () => {
      // Access the logger via the service instance
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loggerSpy = jest.spyOn((service as Record<string, any>).logger, 'warn');

      // The MAX_ENTRIES is 5000, so 80% = 4000 entries
      // We can't realistically insert 4000 entries in a test, so we mock the cache size
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cacheMock = (service as Record<string, any>).cache;

      // Temporarily override size to simulate near-capacity
      Object.defineProperty(cacheMock, 'size', { get: () => 4500, configurable: true });

      // Trigger checkCapacity via getOrSet
      await service.getOrSet('capacity-test', async () => 'value', 60);

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('capacity'));

      loggerSpy.mockRestore();
    });
  });
});
