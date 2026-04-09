import type { EvalQuery, EvalRunResult, EvalScore, EvalReport } from './types';
import { evaluateSourceAccuracy } from './evaluators/source-accuracy';
import { evaluateQualityChecklist } from './evaluators/quality-judge';
import { evaluateEfficiency } from './evaluators/efficiency';
import { evaluateLatency } from './evaluators/latency';
import { evaluateCost } from './evaluators/cost';

/** Weight distribution across evaluator dimensions. */
export const WEIGHTS = {
  sourceAccuracy: 0.3,
  qualityChecklist: 0.3,
  efficiency: 0.15,
  latency: 0.15,
  cost: 0.1,
} as const;

/**
 * Run all evaluators on a single result and compute the weighted score.
 *
 * If the response is null (agent error), all scores default to 0.
 */
export async function scoreRun(
  result: EvalRunResult,
  query: EvalQuery,
  provider: string,
  skipJudge = false,
): Promise<EvalScore> {
  const { response } = result;

  if (!response) {
    return {
      queryId: result.queryId,
      sourceAccuracy: 0,
      qualityChecklist: 0,
      efficiency: 0,
      latency: 0,
      cost: 0,
      weighted: 0,
      details: { error: result.error ?? 'No response' },
    };
  }

  const srcPromise = evaluateSourceAccuracy(response);
  const qualPromise = skipJudge
    ? Promise.resolve({ key: 'quality_checklist', score: 0, comment: 'skipped (--no-judge)' })
    : evaluateQualityChecklist(response, query.expectedQualities);

  const [srcResult, qualResult] = await Promise.all([srcPromise, qualPromise]);

  const effResult = evaluateEfficiency(response.steps.length, query.maxAcceptableSteps);
  const latResult = evaluateLatency(result.durationMs, provider);
  const costResult = evaluateCost(
    response.meta.totalInputTokens,
    response.meta.totalOutputTokens,
    provider,
  );

  const sourceAccuracy = srcResult.score;
  const qualityChecklist = qualResult.score;
  const efficiency = effResult.score;
  const latency = latResult.score;
  const cost = costResult.score;

  const weighted =
    sourceAccuracy * WEIGHTS.sourceAccuracy +
    qualityChecklist * WEIGHTS.qualityChecklist +
    efficiency * WEIGHTS.efficiency +
    latency * WEIGHTS.latency +
    cost * WEIGHTS.cost;

  const details: Record<string, unknown> = {};
  if (srcResult.comment) details[srcResult.key] = srcResult.comment;
  if (qualResult.comment) details[qualResult.key] = qualResult.comment;
  if (effResult.comment) details[effResult.key] = effResult.comment;
  if (latResult.comment) details[latResult.key] = latResult.comment;
  if (costResult.comment) details[costResult.key] = costResult.comment;

  return {
    queryId: result.queryId,
    sourceAccuracy,
    qualityChecklist,
    efficiency,
    latency,
    cost,
    weighted,
    details,
  };
}

/**
 * Aggregate individual EvalScores into a full EvalReport.
 */
export function buildReport(scores: EvalScore[], provider: string): EvalReport {
  const n = scores.length;

  if (n === 0) {
    return {
      provider,
      timestamp: new Date().toISOString(),
      queries: 0,
      scores,
      summary: {
        avgWeighted: 0,
        avgSourceAccuracy: 0,
        avgQualityChecklist: 0,
        avgEfficiency: 0,
        avgLatency: 0,
        avgCost: 0,
        passRate: 0,
      },
    };
  }

  const sum = (fn: (s: EvalScore) => number) => scores.reduce((acc, s) => acc + fn(s), 0);

  const avgWeighted = sum((s) => s.weighted) / n;
  const avgSourceAccuracy = sum((s) => s.sourceAccuracy) / n;
  const avgQualityChecklist = sum((s) => s.qualityChecklist) / n;
  const avgEfficiency = sum((s) => s.efficiency) / n;
  const avgLatency = sum((s) => s.latency) / n;
  const avgCost = sum((s) => s.cost) / n;

  const passing = scores.filter((s) => s.weighted >= 0.6).length;
  const passRate = (passing / n) * 100;

  return {
    provider,
    timestamp: new Date().toISOString(),
    queries: n,
    scores,
    summary: {
      avgWeighted,
      avgSourceAccuracy,
      avgQualityChecklist,
      avgEfficiency,
      avgLatency,
      avgCost,
      passRate,
    },
  };
}

/**
 * Print a single-provider eval report to stdout.
 */
export function printReport(report: EvalReport): void {
  const { provider, timestamp, queries, scores, summary } = report;
  const sep = '\u2500'.repeat(60);

  console.log(`\nVoxPopuli Eval Report \u2014 ${provider}`);
  console.log(`${timestamp}`);
  console.log(`Queries: ${queries} | Pass Rate: ${summary.passRate.toFixed(1)}%\n`);

  const header =
    pad('Query', 10) +
    pad('Source', 8) +
    pad('Quality', 8) +
    pad('Effic.', 8) +
    pad('Latency', 8) +
    pad('Cost', 8) +
    pad('Total', 8);
  console.log(header);
  console.log(sep);

  for (const s of scores) {
    const row =
      pad(s.queryId, 10) +
      pad(fmt(s.sourceAccuracy), 8) +
      pad(fmt(s.qualityChecklist), 8) +
      pad(fmt(s.efficiency), 8) +
      pad(fmt(s.latency), 8) +
      pad(fmt(s.cost), 8) +
      pad(fmt(s.weighted), 8);
    console.log(row);
  }

  console.log(sep);
  const avg =
    pad('AVERAGE', 10) +
    pad(fmt(summary.avgSourceAccuracy), 8) +
    pad(fmt(summary.avgQualityChecklist), 8) +
    pad(fmt(summary.avgEfficiency), 8) +
    pad(fmt(summary.avgLatency), 8) +
    pad(fmt(summary.avgCost), 8) +
    pad(fmt(summary.avgWeighted), 8);
  console.log(avg);
  console.log('');
}

/**
 * Print a side-by-side comparison of multiple provider reports.
 */
export function printComparison(reports: EvalReport[]): void {
  if (reports.length === 0) return;

  const sep = '\u2500'.repeat(70);
  console.log('\nVoxPopuli Provider Comparison');
  console.log(sep);

  const header = pad('Metric', 20) + reports.map((r) => pad(r.provider, 12)).join('');
  console.log(header);
  console.log(sep);

  const metrics: [string, (s: EvalReport['summary']) => number][] = [
    ['Source Accuracy', (s) => s.avgSourceAccuracy],
    ['Quality', (s) => s.avgQualityChecklist],
    ['Efficiency', (s) => s.avgEfficiency],
    ['Latency', (s) => s.avgLatency],
    ['Cost', (s) => s.avgCost],
    ['Weighted Avg', (s) => s.avgWeighted],
    ['Pass Rate (%)', (s) => s.passRate],
  ];

  for (const [label, fn] of metrics) {
    const row =
      pad(label, 20) +
      reports
        .map((r) => {
          const val = fn(r.summary);
          return pad(label === 'Pass Rate (%)' ? val.toFixed(1) : fmt(val), 12);
        })
        .join('');
    console.log(row);
  }

  console.log(sep);
  console.log('');
}

/** Format a number to 2 decimal places. */
function fmt(n: number): string {
  return n.toFixed(2);
}

/** Left-pad a string to a given width. */
function pad(s: string, width: number): string {
  return s.padEnd(width);
}
