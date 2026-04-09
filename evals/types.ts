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

/** Result of running a single query through the agent. */
export interface EvalRunResult {
  queryId: string;
  query: string;
  response: AgentResponse | null;
  durationMs: number;
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
  details: Record<string, unknown>;
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
  };
}

/** Result from an individual evaluator. */
export interface EvaluatorResult {
  key: string;
  score: number;
  comment?: string;
}
