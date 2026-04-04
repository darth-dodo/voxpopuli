import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { RagController } from './rag.controller';

/**
 * Module providing the RAG endpoints for VoxPopuli.
 *
 * Imports AgentModule for the ReAct agent loop.
 * CacheModule is `@Global()` so it does not need an explicit import.
 */
@Module({
  imports: [AgentModule],
  controllers: [RagController],
})
export class RagModule {}
