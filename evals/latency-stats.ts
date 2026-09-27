import type { EvalReport, EvalScore, LatencySummary, PipelineStageName } from './types';

const STAGES: PipelineStageName[] = ['retriever', 'synthesizer', 'writer'];

/** Nearest-rank percentile of an unsorted sample (p in 0-100). Returns 0 for an empty sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Summarize wall-clock latency across successful runs.
 * Errored runs are excluded — a 5ms failure would otherwise look like a fast answer.
 */
export function summarizeLatency(scores: EvalScore[]): LatencySummary {
  const ok = scores.filter((s) => s.durationMs !== undefined && !s.details['error']);
  const durations = ok.map((s) => s.durationMs as number);

  const stageMeanMs: Partial<Record<PipelineStageName, number>> = {};
  for (const stage of STAGES) {
    const samples = ok
      .map((s) => s.timings?.stages[stage])
      .filter((v): v is number => typeof v === 'number');
    if (samples.length > 0) stageMeanMs[stage] = mean(samples);
  }

  return {
    samples: durations.length,
    meanMs: mean(durations),
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    fallbacks: ok.filter((s) => s.timings?.fallback).length,
    stageMeanMs,
  };
}

/** Percentage change from `before` to `after` (negative = faster). */
export function pctChange(before: number, after: number): number {
  return before === 0 ? 0 : ((after - before) / before) * 100;
}

/** Print a before/after latency table for two reports that both carry a latency summary. */
export function printLatencyDiff(baseline: EvalReport, current: EvalReport): void {
  const b = baseline.summary.latency;
  const c = current.summary.latency;
  if (!b || !c) {
    console.log('\nLatency diff unavailable: baseline report has no latency summary.\n');
    return;
  }

  const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`.padEnd(10);
  const pct = (before: number, after: number) => {
    const v = pctChange(before, after);
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  };
  const row = (label: string, before?: number, after?: number) => {
    if (before === undefined || after === undefined) return;
    console.log(`${label.padEnd(20)}${sec(before)}${sec(after)}${pct(before, after)}`);
  };

  console.log(`\nLatency vs baseline (${baseline.timestamp})`);
  console.log('─'.repeat(50));
  console.log(`${'Metric'.padEnd(20)}${'Before'.padEnd(10)}${'After'.padEnd(10)}Change`);
  row('Mean', b.meanMs, c.meanMs);
  row('p50', b.p50Ms, c.p50Ms);
  row('p95', b.p95Ms, c.p95Ms);
  for (const stage of STAGES) row(`  ${stage}`, b.stageMeanMs[stage], c.stageMeanMs[stage]);
  console.log(
    `${'Fallbacks'.padEnd(20)}${String(b.fallbacks).padEnd(10)}${String(c.fallbacks).padEnd(10)}`,
  );
  console.log(`${'Samples'.padEnd(20)}${String(b.samples).padEnd(10)}${String(c.samples)}`);
  console.log('');
}
