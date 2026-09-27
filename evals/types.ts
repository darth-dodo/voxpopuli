import type { AgentResponse } from '@voxpopuli/shared-types';

/** A single test query from queries.json. */
export interface EvalQuery {
  id: string;
  query: string;
  category: string;
  expectedQualities: string[];
  expectedMinSources: number;
  maxAcceptableSteps: number;
  skip?: boolean;
}

export type PipelineStageName = 'retriever' | 'synthesizer' | 'writer';

/** Latency detail captured when a query is run over SSE (`--stream`). */
export interface LatencyTimings {
  /** Time until the first SSE event arrived. */
  firstEventMs: number;
  /** Per-stage elapsed time reported by the pipeline's `done` events. */
  stages: Partial<Record<PipelineStageName, number>>;
  /** True when the pipeline failed and the legacy agent re-ran the query. */
  fallback: boolean;
}

/** Result of running a single query through the agent. */
export interface EvalRunResult {
  queryId: string;
  query: string;
  response: AgentResponse | null;
  durationMs: number;
  timings?: LatencyTimings;
  error?: string;
}

/** Score breakdown for a single eval run. */
export interface EvalScore {
  queryId: string;
  sourceAccuracy: number;
  qualityChecklist: number;
  efficiency: number;
  latency: number;
  cost: number;
  weighted: number;
  /** Raw wall-clock time — kept alongside the banded latency score for A/B comparisons. */
  durationMs?: number;
  timings?: LatencyTimings;
  details: Record<string, unknown>;
}

/** Aggregate wall-clock latency for a report (successful runs only). */
export interface LatencySummary {
  samples: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  fallbacks: number;
  stageMeanMs: Partial<Record<PipelineStageName, number>>;
}

/** Full eval report for one provider run. */
export interface EvalReport {
  provider: string;
  timestamp: string;
  queries: number;
  scores: EvalScore[];
  summary: {
    avgWeighted: number;
    avgSourceAccuracy: number;
    avgQualityChecklist: number;
    avgEfficiency: number;
    avgLatency: number;
    avgCost: number;
    passRate: number;
    /** Absent in reports produced before latency tracking was added. */
    latency?: LatencySummary;
  };
}

/** Result from an individual evaluator. */
export interface EvaluatorResult {
  key: string;
  score: number;
  comment?: string;
}
