# VoxPopuli Eval Harness

Black-box evaluation harness for the VoxPopuli RAG agent. Calls the API over HTTP, scores responses across five dimensions, and produces JSON reports. By default it runs what users run: the multi-agent pipeline over SSE (`GET /api/rag/stream?useMultiAgent=true`).

## Quick Start

```bash
# Start the API first
npx nx serve api

# Run all queries with the default provider
npx tsx evals/run-eval.ts

# Run with a specific provider
npx tsx evals/run-eval.ts -p mistral

# Run a single query for debugging
npx tsx evals/run-eval.ts -q q01

# Filter by category
npx tsx evals/run-eval.ts -C tool_comparison

# Fast mode (skip LLM-as-judge)
npx tsx evals/run-eval.ts --no-judge

# Compare providers side by side
npx tsx evals/run-eval.ts -c openrouter,mistral,claude

# Dry run — preview without calling API
npx tsx evals/run-eval.ts --dry-run

# List all available queries
npx tsx evals/run-eval.ts --list

# Latency A/B: compare a later run against a saved baseline (pipeline over SSE is the default)
npx tsx evals/run-eval.ts -n 1
npx tsx evals/run-eval.ts -n 1 --baseline evals/results/<baseline>.json

# Evaluate the legacy single-agent path (users only reach it on pipeline fallback)
npx tsx evals/run-eval.ts --legacy
```

## CLI Options

| Flag                    | Description                                              | Default                           |
| ----------------------- | -------------------------------------------------------- | --------------------------------- |
| `-p, --provider <name>` | LLM provider to evaluate                                 | `mistral` (or `LLM_PROVIDER` env) |
| `-c, --compare <list>`  | Compare multiple providers (comma-separated)             | —                                 |
| `-q, --query <id>`      | Run a single query by ID                                 | all queries                       |
| `-C, --category <name>` | Filter queries by category                               | all categories                    |
| `--list`                | List available queries and exit                          | —                                 |
| `--dry-run`             | Preview without calling the API                          | —                                 |
| `--no-langsmith`        | Skip LangSmith dataset sync                              | sync enabled                      |
| `--no-judge`            | Skip LLM-as-judge (faster, partial scores)               | judge enabled                     |
| `-t, --timeout <sec>`   | Per-query timeout                                        | `300`                             |
| `-n, --concurrency <n>` | Max parallel queries (API cap: 5)                        | `3`                               |
| `--legacy`              | Evaluate the legacy single agent instead of the pipeline | pipeline (what users run)         |
| `--no-stream`           | Use `POST /rag/query` (cached 10 min, no stage timings)  | SSE stream (what users run)       |
| `--multi-agent`         | Deprecated no-op; the pipeline is the default            | —                                 |
| `--stream`              | No-op; SSE is the default (kept for older commands)      | —                                 |
| `--baseline <file>`     | Print latency change vs a previous results JSON          | —                                 |

## Scoring System

Each query is scored across five dimensions with fixed weights:

| Dimension             | Weight | What It Measures                                            |
| --------------------- | ------ | ----------------------------------------------------------- |
| **Source Accuracy**   | 30%    | Verifies each cited `storyId` exists via HN Firebase API    |
| **Quality Checklist** | 30%    | LLM-as-judge checks `expectedQualities` from `queries.json` |
| **Efficiency**        | 15%    | Tool calls vs `maxAcceptableSteps` threshold                |
| **Latency**           | 15%    | Response time vs provider-specific thresholds               |
| **Cost**              | 10%    | Token usage (input + output) vs provider pricing            |

**Efficiency** counts tool calls (`action` steps), which is what `maxAcceptableSteps` budgets — the
agent's step limit is also counted in actions. **Cost** is `max(0, 1 − cost / $0.05)`, the $0.05
ceiling being product.md's maximum acceptable cost per query; rates in `evaluators/cost.ts` are list
prices for the configured models (Mistral Small 4 $0.15/$0.60, Claude Haiku 4.5 $1/$5, OpenRouter
`qwen/qwen3-235b-a22b-2507` $0.087/$0.35 per million input/output tokens; unknown providers use the
OpenRouter rate — before 2026-09-28 they were 10–13× too high for both). A run that **fell back to the legacy
agent** scores 0 on both: only the fallback's tokens and steps are reported, so it would otherwise
look cheap and lean.

**Pass threshold:** Weighted score >= 0.60

### Latency Thresholds

| Provider   | Excellent (1.0) | Good (0.6-0.7) | Acceptable (0.3) | Fail (0.0) |
| ---------- | --------------- | -------------- | ---------------- | ---------- |
| OpenRouter | < 15s           | < 30s          | < 60s            | >= 60s     |
| Mistral    | < 30s           | < 60s          | < 90s            | >= 90s     |
| Claude     | < 30s           | < 60s          | < 120s           | >= 120s    |

### Measuring Latency (ADR-009)

The banded latency score hides the actual numbers, so every report also stores raw
`durationMs` per query and a `summary.latency` block: mean, p50, p95, per-stage means
(`retriever`/`synthesizer`/`writer`, from the pipeline's `done` events) and the number of runs
that **fell back to the legacy agent** — the most expensive failure mode.

- Keep the default SSE mode for latency work. `--no-stream` uses `POST /rag/query`, which serves
  repeat queries from a 10-minute cache, so a re-run inside that window measures cache hits. Stage
  timings and fallback detection only exist over SSE.
- Use `-n 1` for A/B comparisons. Mistral's limit is 100k tokens/minute and one pipeline query can
  consume most of it; concurrent runs measure provider backoff, not the code.
- Errored runs are excluded from the latency summary so fast failures don't look like fast answers.

### Source Accuracy

Each source's `storyId` is verified against the HN Firebase API (`hacker-news.firebaseio.com/v0/item/{id}.json`). Score = verified / total. A response with 3 sources where 2 verify = 0.67.

### Quality Checklist (LLM-as-Judge)

Uses the judge provider (default: Mistral, configurable via `EVAL_JUDGE_PROVIDER`) to check the response against `expectedQualities` from `queries.json`. Each quality is scored as met/not-met. Skipped with `--no-judge` (score defaults to 0).

## Query Categories

| Category           | Queries | Description                                                 |
| ------------------ | ------- | ----------------------------------------------------------- |
| `tool_comparison`  | q01-q05 | "A vs B" comparisons between tools/frameworks               |
| `opinion`          | q06-q09 | Broad opinion/sentiment questions                           |
| `specific_project` | q10-q12 | Questions about specific tools/services                     |
| `recent_events`    | q13-q15 | Questions about recent HN activity                          |
| `deep_dive`        | q16-q18 | Complex questions requiring deep analysis                   |
| `edge_case`        | q19-q20 | Nonsense queries, off-topic questions                       |
| `trust`            | t01-t07 | Trust metadata validation (bias, honesty flags, source age) |

## Test Queries

Defined in `queries.json`. Each query specifies:

```json
{
  "id": "q01",
  "query": "What does HN think about Rust vs Go for backend services?",
  "category": "tool_comparison",
  "expectedQualities": [
    "presents arguments for both Rust and Go",
    "cites specific HN discussions or user opinions",
    "mentions performance, developer experience, or ecosystem trade-offs"
  ],
  "expectedMinSources": 2,
  "maxAcceptableSteps": 5
}
```

Edit queries in `queries.json`, not the LangSmith UI — the harness syncs from this file on each run.

## Results

JSON reports are saved to `evals/results/` with timestamp and provider name:

```
evals/results/2026-04-11T19-54-15-277Z-mistral.json
```

Each report contains per-query scores and an aggregate summary:

```json
{
  "provider": "mistral",
  "timestamp": "2026-04-11T19:54:15.274Z",
  "queries": 25,
  "scores": [...],
  "summary": {
    "avgWeighted": 0.52,
    "avgSourceAccuracy": 0.56,
    "passRate": 44.0,
    "latency": { "samples": ..., "meanMs": ..., "p50Ms": ..., "p95Ms": ..., "fallbacks": ..., "stageMeanMs": { ... } }
  }
}
```

## Architecture

```
queries.json          Source of truth for test queries
run-eval.ts           CLI entry point (Commander)
stream-client.ts      SSE client: parses events, records per-stage timings and fallbacks
latency-stats.ts      summary.latency (mean/p50/p95, stage means) and --baseline comparison
dataset.ts            LangSmith dataset sync helper
score.ts              Score aggregation and report building
feedback.ts           Post scores to LangSmith as run feedback
types.ts              EvalQuery, EvalRunResult, EvalScore, EvalReport
evaluators/
  source-accuracy.ts  Verify storyIds against HN Firebase API
  quality-judge.ts    LLM-as-judge for expectedQualities
  efficiency.ts       Tool calls vs maxAcceptableSteps
  latency.ts          Duration vs provider-specific thresholds
  cost.ts             Token usage vs provider pricing
```

The harness is fully black-box — it calls the API over HTTP, never imports NestJS services. The one exception: the LLM-as-judge makes direct Mistral API calls (not through the VoxPopuli API).

## Environment Variables

| Variable              | Required | Description                                     |
| --------------------- | -------- | ----------------------------------------------- |
| `EVAL_API_URL`        | No       | API base URL (default: `http://localhost:3000`) |
| `LLM_PROVIDER`        | No       | Default provider (default: `mistral`)           |
| `EVAL_JUDGE_PROVIDER` | No       | LLM-as-judge provider (default: `mistral`)      |
| `LANGSMITH_API_KEY`   | No       | LangSmith API key for dataset sync              |
| `LANGSMITH_TRACING`   | No       | Enable LangSmith tracing (`true`/`false`)       |
