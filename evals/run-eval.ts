import 'dotenv/config';

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import type { AgentResponse } from '@voxpopuli/shared-types';
import type { EvalRunResult, EvalScore, EvalReport } from './types';
import { loadQueries, syncToLangSmith } from './dataset';
import { scoreRun, buildReport, printReport, printComparison } from './score';
import { postScoresToLangSmith } from './feedback';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EVAL_API_URL = process.env.EVAL_API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command()
  .name('voxpopuli-eval')
  .description('Evaluation harness for the VoxPopuli RAG agent')
  .version('1.0.0')
  .option('-p, --provider <name>', 'LLM provider to evaluate', process.env.LLM_PROVIDER || 'groq')
  .option('-c, --compare <providers>', 'compare multiple providers (comma-separated)', (val) =>
    val.split(',').map((s) => s.trim()),
  )
  .option('-q, --query <id>', 'run a single query by ID')
  .option('-C, --category <name>', 'filter queries by category')
  .option('--list', 'list available queries and exit')
  .option('--dry-run', 'show what would run without calling the API')
  .option('--no-langsmith', 'skip LangSmith dataset sync')
  .option('-t, --timeout <seconds>', 'per-query timeout in seconds', '300')
  .option('-n, --concurrency <n>', 'max parallel queries (API supports up to 5)', '3')
  .option('--no-judge', 'skip LLM-as-judge (faster, scores only source/efficiency/latency/cost)')
  .parse();

const opts = program.opts<{
  provider: string;
  compare?: string[];
  query?: string;
  category?: string;
  list?: boolean;
  dryRun?: boolean;
  langsmith: boolean;
  timeout: string;
  concurrency: string;
  judge: boolean;
}>();

// ---------------------------------------------------------------------------
// API health check
// ---------------------------------------------------------------------------

async function checkApiHealth(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/api/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API call helper
// ---------------------------------------------------------------------------

async function runQuery(
  query: string,
  provider: string,
  apiUrl: string,
  timeoutMs: number,
): Promise<EvalRunResult> {
  const start = performance.now();
  try {
    const res = await fetch(`${apiUrl}/api/rag/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, provider }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const response = (await res.json()) as AgentResponse;
    return { queryId: '', query, response, durationMs: performance.now() - start };
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
// Formatting helpers
// ---------------------------------------------------------------------------

function elapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function statusIcon(weighted: number, hasError: boolean): string {
  if (hasError) return '\u2716'; // ✖
  return weighted >= 0.6 ? '\u2714' : '\u25CB'; // ✔ or ○
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Load and filter queries
  let queries = loadQueries();

  // --list: show available queries and exit
  if (opts.list) {
    console.log(`\nAvailable queries (${queries.length} total):\n`);
    const categories = new Map<string, typeof queries>();
    for (const q of queries) {
      const cat = categories.get(q.category) ?? [];
      cat.push(q);
      categories.set(q.category, cat);
    }
    for (const [cat, qs] of categories) {
      console.log(`  ${cat} (${qs.length}):`);
      for (const q of qs) {
        const skip = q.skip ? ' [skip]' : '';
        console.log(`    ${q.id.padEnd(6)} ${q.query.substring(0, 70)}${skip}`);
      }
    }
    console.log('');
    return;
  }

  // Apply filters
  if (opts.query) {
    queries = queries.filter((q) => q.id === opts.query);
    if (queries.length === 0) {
      console.error(`No query found with id "${opts.query}"`);
      process.exit(1);
    }
  }

  if (opts.category) {
    queries = queries.filter((q) => q.category === opts.category);
    if (queries.length === 0) {
      const cats = [...new Set(loadQueries().map((q) => q.category))];
      console.error(`No queries in category "${opts.category}". Available: ${cats.join(', ')}`);
      process.exit(1);
    }
  }

  // Skip queries marked with skip: true
  queries = queries.filter((q) => !q.skip);

  if (queries.length === 0) {
    console.log('No queries to run.');
    return;
  }

  // --dry-run: show what would run and exit
  if (opts.dryRun) {
    const providers = opts.compare ?? [opts.provider];
    console.log(
      `\nDry run — would execute ${queries.length} queries against: ${providers.join(', ')}`,
    );
    console.log(`API: ${EVAL_API_URL}\n`);
    for (const q of queries) {
      console.log(`  ${q.id.padEnd(6)} ${q.query.substring(0, 70)}`);
    }
    console.log('');
    return;
  }

  // Health check
  const healthy = await checkApiHealth(EVAL_API_URL);
  if (!healthy) {
    console.error(`\nAPI not reachable at ${EVAL_API_URL}`);
    console.error('Start the API first: npx nx serve api\n');
    process.exit(1);
  }

  // LangSmith sync
  if (opts.langsmith) {
    await syncToLangSmith(queries);
  }

  // Run evals
  const providers = opts.compare ?? [opts.provider];
  const reports: EvalReport[] = [];
  const timeoutMs = parseInt(opts.timeout, 10) * 1000;
  const concurrency = Math.min(parseInt(opts.concurrency, 10), 5);
  const skipJudge = !opts.judge;

  for (const p of providers) {
    console.log(
      `\nRunning eval for provider: ${p} (${queries.length} queries, concurrency=${concurrency}${
        skipJudge ? ', no-judge' : ''
      })\n`,
    );

    const scores: EvalScore[] = new Array(queries.length);
    let completed = 0;
    let passed = 0;
    let failed = 0;
    let errors = 0;
    const startTime = performance.now();

    // Process queries in batches of `concurrency`
    for (let batch = 0; batch < queries.length; batch += concurrency) {
      const batchQueries = queries.slice(batch, batch + concurrency);

      const batchResults = await Promise.allSettled(
        batchQueries.map(async (q, batchIdx) => {
          const idx = batch + batchIdx;
          const result = await runQuery(q.query, p, EVAL_API_URL, timeoutMs);
          result.queryId = q.id;

          const score = await scoreRun(result, q, p, skipJudge);
          scores[idx] = score;

          // Post scores to LangSmith as feedback (non-blocking)
          if (opts.langsmith) {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            postScoresToLangSmith(score, q, p).catch(() => {});
          }

          return { result, score, idx };
        }),
      );

      // Print results for this batch
      for (const settled of batchResults) {
        completed++;
        if (settled.status === 'rejected') {
          errors++;
          console.log(
            `  [${String(completed).padStart(2)}/${queries.length}] ??? \u2716 ERR: ${
              settled.reason
            }`,
          );
          continue;
        }

        const { result, score } = settled.value;
        const q = queries[settled.value.idx];
        const label = q.query.length > 50 ? q.query.substring(0, 50) + '...' : q.query;
        const icon = statusIcon(score.weighted, !!result.error);
        const time = elapsed(result.durationMs);

        if (result.error) {
          errors++;
          console.log(
            `  [${String(completed).padStart(2)}/${queries.length}] ${q.id.padEnd(
              5,
            )} ${icon} ERR ${time}`,
          );
        } else {
          if (score.weighted >= 0.6) passed++;
          else failed++;
          console.log(
            `  [${String(completed).padStart(2)}/${queries.length}] ${q.id.padEnd(
              5,
            )} ${icon} ${score.weighted.toFixed(2)} ${time}  ${label}`,
          );
        }
      }
    }

    const totalTime = elapsed(performance.now() - startTime);
    console.log(
      `\n  Results: ${passed} passed, ${failed} below threshold, ${errors} errors (${totalTime} total)`,
    );

    const report = buildReport(scores, p);
    printReport(report);

    const savedPath = saveReport(report, p);
    console.log(`Results saved to ${savedPath}`);

    reports.push(report);
  }

  if (opts.compare && reports.length > 1) {
    printComparison(reports);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Eval runner failed:', err);
  process.exit(1);
});
