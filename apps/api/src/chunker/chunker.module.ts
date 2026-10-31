import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { ChunkerService } from './chunker.service';

/**
 * Module providing the {@link ChunkerService} for tokenising and assembling
 * Hacker News content into LLM context windows.
 *
 * Stateless. Imports LlmModule so token estimates use the active provider's
 * estimator. CacheModule is `@Global()` so it does not need an explicit import.
 */
@Module({
  imports: [LlmModule],
  providers: [ChunkerService],
  exports: [ChunkerService],
})
export class ChunkerModule {}
