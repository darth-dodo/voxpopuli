import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HnService } from './hn.service';
import { HnController } from './hn.controller';

/**
 * Module providing the {@link HnService} for Hacker News data retrieval.
 *
 * Imports `HttpModule` for Algolia and Firebase HTTP calls.
 * CacheModule is `@Global()` so it does not need an explicit import.
 */
@Module({
  imports: [
    HttpModule.register({
      timeout: 10_000,
      maxRedirects: 3,
    }),
  ],
  controllers: [HnController],
  providers: [HnService],
  exports: [HnService],
})
export class HnModule {}
