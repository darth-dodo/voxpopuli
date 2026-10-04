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

/** Default hard timeout for one pipeline run, below the legacy agent's 180s. */
export const DEFAULT_PIPELINE_TIMEOUT_MS = 150_000;

/** Pipeline configuration with per-agent provider mapping and a hard run timeout. */
export const PipelineConfigSchema = z.object({
  useMultiAgent: z.boolean().default(false),
  providerMap: z
    .object({
      retriever: z.string().optional(),
      synthesizer: z.string().optional(),
      writer: z.string().optional(),
    })
    .default({}),
  /**
   * Hard cap (ms) on a whole pipeline run; in-flight LLM calls are aborted when it
   * fires. `PIPELINE_TIMEOUT_MS` overrides it server-side.
   */
  timeout: z.number().int().positive().default(DEFAULT_PIPELINE_TIMEOUT_MS),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/**
 * Evidence gathered by a completed pipeline run, kept so a follow-up question can
 * reuse it instead of searching HN again.
 */
export interface PriorEvidence {
  /** The question the evidence was gathered for. */
  query: string;
  bundle: z.infer<typeof EvidenceBundleSchema>;
  /** Retriever steps, reused for trust metadata (source recency, verification). */
  steps: import('./shared-types').AgentStep[];
}

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
