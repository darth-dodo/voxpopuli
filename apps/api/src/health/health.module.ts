import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [HealthController],
})
export class HealthModule {}
