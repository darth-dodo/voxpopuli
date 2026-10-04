import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';
import { QueryStore } from './query-store';
import { KEY_VALUE_STORE, createKeyValueStore } from './key-value-store';

/**
 * Global cache module that exposes {@link CacheService} and {@link QueryStore}
 * to the entire application without needing explicit imports in every consumer module.
 *
 * `KEY_VALUE_STORE` is Redis when `REDIS_URL` is set, otherwise in-memory (ADR-011).
 */
@Global()
@Module({
  providers: [
    CacheService,
    {
      provide: KEY_VALUE_STORE,
      useFactory: (cache: CacheService, config?: ConfigService) =>
        createKeyValueStore(config?.get<string>('REDIS_URL') ?? process.env.REDIS_URL, cache),
      inject: [CacheService, { token: ConfigService, optional: true }],
    },
    QueryStore,
  ],
  exports: [CacheService, QueryStore],
})
export class CacheModule {}
