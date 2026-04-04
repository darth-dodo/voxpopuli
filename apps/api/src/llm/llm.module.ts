import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/**
 * Module providing the {@link LlmService} facade for LLM provider access.
 *
 * ConfigModule is `@Global()` (registered in AppModule) so it does not
 * need an explicit import here.
 */
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
