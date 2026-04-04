import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { HnModule } from '../hn/hn.module';
import { ChunkerModule } from '../chunker/chunker.module';
import { LlmModule } from '../llm/llm.module';

/**
 * Module providing the {@link AgentService} for the VoxPopuli ReAct agent.
 *
 * Imports HnModule (HN API access), ChunkerModule (token budgeting),
 * and LlmModule (LLM provider facade).
 */
@Module({
  imports: [HnModule, ChunkerModule, LlmModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
