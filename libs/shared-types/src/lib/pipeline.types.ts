import { z } from 'zod';
import { EvidenceBundleSchema } from './evidence.types';
import { AnalysisResultSchema } from './analysis.types';
import { AgentResponseV2Schema } from './response-v2.types';

export const PipelineStageSchema = z.enum(['retriever', 'synthesizer', 'writer']);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const StageStatusSchema = z.enum(['started', 'progress', 'done', 'error']);
export type StageStatus = z.infer<typeof StageStatusSchema>;

/** SSE event emitted by the pipeline at stage transitions. */
export const PipelineEventSchema = z.object({
  stage: PipelineStageSchema,
  status: StageStatusSchema,
  detail: z.string(),
  elapsed: z.number(),
});
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;

/** Pipeline configuration with per-agent provider mapping and token budgets. */
export const PipelineConfigSchema = z.object({
  useMultiAgent: z.boolean().default(false),
  providerMap: z
    .object({
      retriever: z.string().optional(),
      synthesizer: z.string().optional(),
      writer: z.string().optional(),
    })
    .default({}),
  tokenBudgets: z
    .object({
      retriever: z.number().default(2000),
      synthesizer: z.number().default(1500),
      synthesizerInput: z.number().default(4000),
      writer: z.number().default(1000),
    })
    .default(() => ({ retriever: 2000, synthesizer: 1500, synthesizerInput: 4000, writer: 1000 })),
  timeout: z.number().default(30000),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/** Full pipeline result with intermediates and timing. */
export const PipelineResultSchema = z.object({
  response: AgentResponseV2Schema,
  bundle: EvidenceBundleSchema,
  analysis: AnalysisResultSchema,
  events: z.array(PipelineEventSchema),
  durationMs: z.number(),
});
export type PipelineResult = z.infer<typeof PipelineResultSchema>;

/** Accumulator state threaded through the LangGraph pipeline. */
export const PipelineStateSchema = z.object({
  query: z.string(),
  bundle: EvidenceBundleSchema.optional(),
  analysis: AnalysisResultSchema.optional(),
  response: AgentResponseV2Schema.optional(),
  events: z.array(PipelineEventSchema),
  error: z.string().optional(),
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;
