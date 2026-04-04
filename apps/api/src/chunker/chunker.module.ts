import { Module } from '@nestjs/common';
import { ChunkerService } from './chunker.service';

/**
 * Module providing the {@link ChunkerService} for tokenising and assembling
 * Hacker News content into LLM context windows.
 *
 * Stateless -- no external dependencies. CacheModule is `@Global()` so it
 * does not need an explicit import.
 */
@Module({
  providers: [ChunkerService],
  exports: [ChunkerService],
})
export class ChunkerModule {}
