import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { OrchestratorService } from './orchestrator.service';
import { HnModule } from '../hn/hn.module';
import { ChunkerModule } from '../chunker/chunker.module';
import { LlmModule } from '../llm/llm.module';

/**
 * Module providing the {@link AgentService} (legacy ReAct) and
 * {@link OrchestratorService} (multi-agent pipeline) for VoxPopuli.
 *
 * Imports HnModule (HN API access), ChunkerModule (token budgeting),
 * and LlmModule (LLM provider facade).
 */
@Module({
  imports: [HnModule, ChunkerModule, LlmModule],
  providers: [AgentService, OrchestratorService],
  exports: [AgentService, OrchestratorService],
})
export class AgentModule {}
