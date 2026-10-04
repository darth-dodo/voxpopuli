import { Logger } from '@nestjs/common';
import { CacheService } from './cache.service';
import {
  MemoryKeyValueStore,
  RedisKeyValueStore,
  createKeyValueStore,
  type RedisLike,
} from './key-value-store';

const redisCtor = jest.fn();
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation((...args: unknown[]) => {
    redisCtor(...args);
    return { get: jest.fn(), set: jest.fn(), del: jest.fn(), quit: jest.fn(), on: jest.fn() };
  }),
}));

function mockClient(): jest.Mocked<RedisLike> {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  };
}

describe('createKeyValueStore()', () => {
  beforeEach(() => redisCtor.mockClear());

  it.each([undefined, '', '   '])('uses the in-memory store when REDIS_URL is %p', (url) => {
    const store = createKeyValueStore(url, new CacheService());
    expect(store).toBeInstanceOf(MemoryKeyValueStore);
    expect(store.durable).toBe(false);
    expect(redisCtor).not.toHaveBeenCalled();
  });

  it('uses Redis with fail-fast options when REDIS_URL is set', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const store = createKeyValueStore('redis://red-abc:6379', new CacheService());
    expect(store).toBeInstanceOf(RedisKeyValueStore);
    expect(store.durable).toBe(true);
    expect(redisCtor).toHaveBeenCalledWith(
      'redis://red-abc:6379',
      expect.objectContaining({
        keyPrefix: 'vp:',
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: expect.any(Number),
      }),
    );
  });
});

describe('MemoryKeyValueStore', () => {
  it('round-trips values through the shared CacheService', async () => {
    const cache = new CacheService();
    const store = new MemoryKeyValueStore(cache);
    await store.set('k', { a: 1 }, 60);
    expect(await store.get('k')).toEqual({ a: 1 });
    expect(cache.get('k')).toEqual({ a: 1 });
    await store.del('k');
    expect(await store.get('k')).toBeUndefined();
  });
});

describe('RedisKeyValueStore', () => {
  let client: jest.Mocked<RedisLike>;
  let store: RedisKeyValueStore;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    client = mockClient();
    store = new RedisKeyValueStore(client);
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers an error listener so connection errors cannot crash the process', () => {
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    const listener = client.on.mock.calls[0][1] as (err: Error) => void;
    expect(() => listener(new Error('ECONNREFUSED'))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('stores JSON with a native EX TTL (rounded up, at least 1s)', async () => {
    await store.set('query:1', { status: 'complete' }, 900);
    expect(client.set).toHaveBeenCalledWith('query:1', '{"status":"complete"}', 'EX', 900);

    await store.set('x', 'v', 0.2);
    expect(client.set).toHaveBeenLastCalledWith('x', '"v"', 'EX', 1);
  });

  it('parses stored JSON and maps a missing key to undefined', async () => {
    client.get.mockResolvedValueOnce('{"a":1}').mockResolvedValueOnce(null);
    expect(await store.get('k')).toEqual({ a: 1 });
    expect(await store.get('missing')).toBeUndefined();
  });

  it('treats unparseable values as a miss', async () => {
    client.get.mockResolvedValueOnce('not json');
    expect(await store.get('k')).toBeUndefined();
  });

  it('never throws when Redis fails, and throttles the warnings', async () => {
    client.get.mockRejectedValue(new Error('Command timed out'));
    client.set.mockRejectedValue(new Error('Stream isn’t writeable'));
    client.del.mockRejectedValue(new Error('down'));

    await expect(store.get('k')).resolves.toBeUndefined();
    await expect(store.set('k', 1, 60)).resolves.toBeUndefined();
    await expect(store.del('k')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('closes the connection quietly', async () => {
    client.quit.mockRejectedValueOnce(new Error('already closed'));
    await expect(store.close()).resolves.toBeUndefined();
  });
});
