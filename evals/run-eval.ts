import 'dotenv/config';

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalRunResult, EvalScore, EvalReport } from './types';
import { loadQueries, syncToLangSmith } from './dataset';
import { scoreRun, buildReport, printReport, printComparison } from './score';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EVAL_API_URL = process.env.EVAL_API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  provider: string;
  compare: string[] | null;
  queryId: string | null;
} {
  let provider = process.env.LLM_PROVIDER || 'groq';
  let compare: string[] | null = null;
  let queryId: string | null = null;

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--provider':
        provider = argv[++i];
        break;
      case '--compare':
        compare = argv[++i].split(',');
        break;
      case '--query':
        queryId = argv[++i];
        break;
    }
  }

  return { provider, compare, queryId };
}

// ---------------------------------------------------------------------------
// API call helper
// ---------------------------------------------------------------------------

async function runQuery(query: string, provider: string, apiUrl: string): Promise<EvalRunResult> {
  const start = performance.now();
  try {
    const res = await fetch(`${apiUrl}/api/rag/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, provider }),
      signal: AbortSignal.timeout(180_000), // 3 min timeout matching agent timeout
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const response = (await res.json()) as import('@voxpopuli/shared-types').AgentResponse;
    return {
      queryId: '',
      query,
      response,
      durationMs: performance.now() - start,
    };
  } catch (err) {
    return {
      queryId: '',
      query,
      response: null,
      durationMs: performance.now() - start,
      error: String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Result persistence
// ---------------------------------------------------------------------------

function saveReport(report: EvalReport, provider: string): string {
  const resultsDir = join(__dirname, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = join(resultsDir, `${timestamp}-${provider}.json`);
  writeFileSync(filename, JSON.stringify(report, null, 2));
  return filename;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { provider, compare, queryId } = parseArgs(process.argv);

  // Load and filter queries
  let queries = loadQueries();

  if (queryId) {
    queries = queries.filter((q) => q.id === queryId);
    if (queries.length === 0) {
      console.error(`No query found with id "${queryId}"`);
      process.exit(1);
    }
  }

  // Skip queries marked with skip: true
  queries = queries.filter((q) => !q.skip);

  // Sync dataset to LangSmith (optional)
  await syncToLangSmith(queries);

  // Determine providers to evaluate
  const providers = compare ?? [provider];
  const reports: EvalReport[] = [];

  for (const p of providers) {
    console.log(`\nRunning eval for provider: ${p} (${queries.length} queries)`);

    const scores: EvalScore[] = [];

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const label = q.query.length > 60 ? q.query.substring(0, 60) + '...' : q.query;
      console.log(`  [${i + 1}/${queries.length}] ${q.id}: ${label}`);

      const result = await runQuery(q.query, p, EVAL_API_URL);
      result.queryId = q.id;

      const score = await scoreRun(result, q, p);
      scores.push(score);
    }

    const report = buildReport(scores, p);
    printReport(report);

    const savedPath = saveReport(report, p);
    console.log(`Results saved to ${savedPath}`);

    reports.push(report);
  }

  // Print comparison table if multiple providers
  if (compare && reports.length > 1) {
    printComparison(reports);
  }

  console.log('\nDone. Results saved to evals/results/');
}

main().catch((err) => {
  console.error('Eval runner failed:', err);
  process.exit(1);
});
