import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { QueryStore } from './query-store';

/**
 * Global cache module that exposes {@link CacheService} and {@link QueryStore}
 * to the entire application without needing explicit imports in every consumer module.
 */
@Global()
@Module({
  providers: [CacheService, QueryStore],
  exports: [CacheService, QueryStore],
})
export class CacheModule {}
