# M6: Eval Harness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an automated evaluation harness that tests VoxPopuli's agent against 27 queries (20 general + 7 trust-specific) and scores responses using LangSmith's `evaluate()` with custom evaluators.

**Architecture:** Standalone TypeScript scripts in `evals/` that call the running API over HTTP (black-box testing). LangSmith provides the evaluation loop, tracing, and dashboard. Queries are version-controlled locally in `queries.json` and synced to a LangSmith dataset on each run. Results are saved both to LangSmith (dashboard) and locally (JSON files in `evals/results/`).

**Tech Stack:** `langsmith` SDK, `tsx` runner, native `fetch` for HTTP calls, Groq as default LLM-as-judge provider.

**Approach:** Hybrid (Approach B from brainstorm) — local queries + LangSmith tracing & scoring.

---

## Prerequisites

- Running VoxPopuli API (`npx nx serve api` on port 3000)
- LangSmith account with API key (free tier: 5k traces/month)
- At least one LLM provider API key configured

## Environment Variables (add to `.env.example`)

```env
# LangSmith (optional — leave empty to skip LangSmith sync)
LANGSMITH_API_KEY=
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=voxpopuli-evals

# Eval config
EVAL_API_URL=http://localhost:3000
EVAL_JUDGE_PROVIDER=groq
```

---

## Task 1: Install Dependencies & Configure tsconfig

**Files:**

- Modify: `package.json` (add `langsmith`, `tsx`, `dotenv` devDependencies)
- Create: `evals/tsconfig.json`

**Step 1: Install dependencies**

```bash
pnpm add -D langsmith tsx dotenv
```

**Step 2: Create evals/tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "outDir": "./dist",
    "rootDir": ".",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true
  },
  "include": ["*.ts", "evaluators/*.ts"],
  "exclude": ["dist", "results"]
}
```

**Step 3: Add npm script to package.json**

Add to `scripts`:

```json
"eval": "tsx evals/run-eval.ts",
"eval:compare": "tsx evals/run-eval.ts --compare groq,mistral,claude"
```

**Step 4: Create results directory**

```bash
mkdir -p evals/results
echo '*.json' > evals/results/.gitignore
echo '!.gitignore' >> evals/results/.gitignore
```

**Step 5: Commit**

```bash
git add evals/tsconfig.json evals/results/.gitignore package.json pnpm-lock.yaml
git commit -m "chore(m6): add eval harness dependencies and tsconfig"
```

---

## Task 2: Create Test Query Dataset (`queries.json`)

**Files:**

- Create: `evals/queries.json`

**Step 1: Write 27 queries (20 general + 7 trust-specific)**

The file contains an array of query objects. Each has:

- `id`: string identifier (q01-q20 for general, t01-t07 for trust)
- `query`: the natural language question
- `category`: one of `tool_comparison`, `opinion`, `specific_project`, `recent_events`, `deep_dive`, `edge_case`, `trust`
- `expectedQualities`: string array of quality signals the answer should exhibit
- `expectedMinSources`: minimum number of sources expected
- `maxAcceptableSteps`: max agent steps before the query is "inefficient"

Categories and counts (from product.md Section 12.5):

- Tool comparisons: 5 (q01-q05)
- Opinion/sentiment: 4 (q06-q09)
- Specific projects: 3 (q10-q12)
- Recent events: 3 (q13-q15)
- Deep-dive requests: 3 (q16-q18)
- Edge cases: 2 (q19-q20)
- Trust-specific: 7 (t01-t07, from product.md Section 13.6)

Trust queries (from product.md):

- t01: "Is Rust better than Go?" — must present both sides
- t02: "What does HN think of xyzzy florbnog?" — must say no results found
- t03: "Is crypto dead?" — must find contrarian view
- t04: Query targeting a Show HN post — must flag vested interest
- t05: Query about a 2019-era tool as if current — must note source age
- t06: Podcast rewrite of a balanced answer — preserve balance (skip until M5)
- t07: Podcast rewrite of heavily-cited answer — retain attributions (skip until M5)

**Step 2: Commit**

```bash
git add evals/queries.json
git commit -m "feat(m6): add 27 eval test queries (20 general + 7 trust)"
```

---

## Task 3: Write Eval Types

**Files:**

- Create: `evals/types.ts`

**Step 1: Define eval-specific types**

```typescript
/** A single test query from queries.json. */
export interface EvalQuery {
  id: string;
  query: string;
  category: string;
  expectedQualities: string[];
  expectedMinSources: number;
  maxAcceptableSteps: number;
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
  sourceAccuracy: number; // 0-1, weight: 0.30
  qualityChecklist: number; // 0-1, weight: 0.30
  efficiency: number; // 0-1, weight: 0.15
  latency: number; // 0-1, weight: 0.15
  cost: number; // 0-1, weight: 0.10
  weighted: number; // 0-1, weighted aggregate
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
    passRate: number; // % of queries scoring >= 0.6
  };
}
```

Import `AgentResponse` from `@voxpopuli/shared-types` (the tsconfig path alias makes this work).

**Step 2: Commit**

```bash
git add evals/types.ts
git commit -m "feat(m6): add eval harness type definitions"
```

---

## Task 4: Implement Source Accuracy Evaluator

**Files:**

- Create: `evals/evaluators/source-accuracy.ts`

**Step 1: Implement the evaluator**

This evaluator checks that every `AgentSource.url` in the response resolves (HTTP 200). Also checks that `AgentSource.storyId` resolves via the Firebase HN API (`https://hacker-news.firebaseio.com/v0/item/{id}.json`).

Logic:

1. For each source in `response.sources`, HEAD request the story URL
2. Also verify `storyId` via Firebase API
3. Score = verified / total (0 if no sources)

Use `Promise.allSettled` for parallel URL checks with a 5s timeout per request.

Return `{ key: "source_accuracy", score: number }`.

**Step 2: Write a unit test**

Create `evals/evaluators/__tests__/source-accuracy.test.ts`. Mock `fetch` to test:

- All sources valid → score 1.0
- Mixed valid/invalid → proportional score
- No sources → score 0
- Timeout handling

**Step 3: Run tests**

```bash
npx vitest run evals/evaluators/__tests__/source-accuracy.test.ts
```

**Step 4: Commit**

```bash
git add evals/evaluators/source-accuracy.ts evals/evaluators/__tests__/source-accuracy.test.ts
git commit -m "feat(m6): implement source accuracy evaluator with tests"
```

---

## Task 5: Implement Quality Checklist Evaluator (LLM-as-Judge)

**Files:**

- Create: `evals/evaluators/quality-judge.ts`

**Step 1: Implement the evaluator**

This evaluator uses an LLM call to check each `expectedQuality` against the answer. Uses Groq (cheapest/fastest) by default, configurable via `EVAL_JUDGE_PROVIDER` env var.

Logic:

1. Build a prompt: "Given this answer and these expected qualities, rate each quality as PRESENT or ABSENT."
2. Call the judge LLM via the VoxPopuli API's own provider (import and use the LangChain model directly — this is the one exception to the black-box rule, since the judge is not the system-under-test)
3. Parse response, count PRESENT / total qualities
4. Score = present / total

Alternatively, to keep it fully black-box: use the `langsmith` SDK's built-in LLM judge support if available, or make a direct Groq API call via `fetch`.

**Recommended approach:** Direct Groq API call via `fetch` to `https://api.groq.com/openai/v1/chat/completions`. This keeps evals fully decoupled from the NestJS app.

Return `{ key: "quality_checklist", score: number, comment: string }` where comment lists which qualities were present/absent.

**Step 2: Write a unit test**

Mock the Groq API call. Test:

- All qualities present → score 1.0
- Partial → proportional
- LLM returns unparseable response → score 0 with error comment

**Step 3: Commit**

```bash
git add evals/evaluators/quality-judge.ts evals/evaluators/__tests__/quality-judge.test.ts
git commit -m "feat(m6): implement LLM-as-judge quality checklist evaluator"
```

---

## Task 6: Implement Efficiency, Latency, and Cost Evaluators

**Files:**

- Create: `evals/evaluators/efficiency.ts`
- Create: `evals/evaluators/latency.ts`
- Create: `evals/evaluators/cost.ts`

**Step 1: Implement efficiency evaluator**

Score = 1.0 if steps <= maxAcceptableSteps, linearly decreasing to 0 at 2x max. Formula: `max(0, 1 - (steps - max) / max)`.

**Step 2: Implement latency evaluator**

Scoring tiers (from product.md):

- < 6s (Groq target): score 1.0
- < 13s (Claude target): score 0.8
- < 30s (P95 target): score 0.5
- > = 30s: score 0.0

Adjust thresholds based on provider.

**Step 3: Implement cost evaluator**

Score based on total tokens vs $0.05 ceiling (from product.md Section 12.3).

- Estimate cost from `meta.totalInputTokens` + `meta.totalOutputTokens` using per-provider rates
- Score = max(0, 1 - estimatedCost / 0.05)

**Step 4: Write tests for all three**

Test each evaluator independently with mock AgentResponse data.

**Step 5: Commit**

```bash
git add evals/evaluators/efficiency.ts evals/evaluators/latency.ts evals/evaluators/cost.ts evals/evaluators/__tests__/
git commit -m "feat(m6): implement efficiency, latency, and cost evaluators"
```

---

## Task 7: Implement Eval Runner (`run-eval.ts`)

**Files:**

- Create: `evals/run-eval.ts`
- Create: `evals/dataset.ts` (LangSmith dataset sync helper)

**Step 1: Implement dataset.ts**

Functions:

- `loadQueries()`: Read and parse `queries.json`, return `EvalQuery[]`
- `syncToLangSmith(queries: EvalQuery[])`: Upload/update a LangSmith dataset named `voxpopuli-evals`. Uses the `langsmith` Client SDK. Skip gracefully if `LANGSMITH_API_KEY` is not set.

**Step 2: Implement run-eval.ts**

CLI entry point. Responsibilities:

1. Load `.env` via `dotenv`
2. Parse CLI args: `--provider <name>`, `--compare <p1,p2,p3>`, `--query <id>` (run single query)
3. Load queries from `queries.json`
4. Sync to LangSmith dataset (if API key present)
5. For each query (or filtered set):
   a. `POST ${EVAL_API_URL}/api/rag/query` with `{ query, provider }`
   b. Capture timing via `performance.now()`
   c. Collect `AgentResponse` or error
6. Run all evaluators on each result
7. Compute weighted scores (source: 0.30, quality: 0.30, efficiency: 0.15, latency: 0.15, cost: 0.10)
8. If LangSmith available, call `evaluate()` from `langsmith/evaluation` with the custom evaluators
9. Save local report to `evals/results/{timestamp}-{provider}.json`
10. Print summary table to stdout

If `--compare` flag: run steps 5-10 for each provider sequentially, then print comparison table.

**Step 3: Commit**

```bash
git add evals/run-eval.ts evals/dataset.ts
git commit -m "feat(m6): implement eval runner with LangSmith integration"
```

---

## Task 8: Implement Score Aggregation (`score.ts`)

**Files:**

- Create: `evals/score.ts`

**Step 1: Implement scoring logic**

Functions:

- `scoreRun(result: EvalRunResult, query: EvalQuery): Promise<EvalScore>` — runs all evaluators, computes weighted aggregate
- `buildReport(scores: EvalScore[], provider: string): EvalReport` — aggregates into summary
- `printReport(report: EvalReport): void` — formats summary table for stdout
- `printComparison(reports: EvalReport[]): void` — side-by-side provider comparison

Weight constants:

```typescript
const WEIGHTS = {
  sourceAccuracy: 0.3,
  qualityChecklist: 0.3,
  efficiency: 0.15,
  latency: 0.15,
  cost: 0.1,
} as const;
```

**Step 2: Write tests**

Test `scoreRun` with mock evaluator results, verify weighted calculation. Test `buildReport` summary math.

**Step 3: Commit**

```bash
git add evals/score.ts evals/__tests__/score.test.ts
git commit -m "feat(m6): implement score aggregation and reporting"
```

---

## Task 9: Add LangSmith Tracing to Agent Service

**Files:**

- Modify: `apps/api/src/main.ts` (env var documentation only — LangChain auto-traces when `LANGSMITH_TRACING=true`)
- Modify: `.env.example`

**Step 1: Verify auto-tracing works**

LangChain.js automatically sends traces to LangSmith when `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` are set. No code changes needed in the agent — this is a LangChain feature.

Verify by:

1. Set env vars
2. Run a query
3. Check LangSmith dashboard for the trace

**Step 2: Update .env.example**

Add the LangSmith and eval env vars.

**Step 3: Commit**

```bash
git add .env.example
git commit -m "chore(m6): add LangSmith and eval config to .env.example"
```

---

## Task 10: Update Documentation

**Files:**

- Modify: `architecture.md` — update M6 section with LangSmith integration details
- Modify: `product.md` — update Section 12 with LangSmith approach
- Modify: `CLAUDE.md` — add eval conventions and commands
- Modify: `README.md` — add eval section if present

**Step 1: Update architecture.md**

Update the M6 milestone section to reflect:

- LangSmith integration (hybrid approach)
- Updated file structure (`evals/evaluators/`, `evals/dataset.ts`)
- `langsmith` dependency
- LangSmith tracing auto-enabled via env vars

**Step 2: Update product.md Section 12**

Add LangSmith references to:

- Section 12.1 (Why) — mention LangSmith dashboard for visual review
- Section 12.4 (Running Evals) — add `LANGSMITH_API_KEY` setup
- Keep the existing CLI commands, they still work

**Step 3: Update CLAUDE.md**

Add to Development Commands:

```
npx tsx evals/run-eval.ts           # Run eval harness (requires running API)
npx tsx evals/run-eval.ts --compare groq,mistral,claude  # Compare providers
```

Add to Key Constraints table:

```
| Eval judge provider   | Groq (default, configurable via EVAL_JUDGE_PROVIDER) |
| Eval pass threshold   | 0.6 weighted score                                   |
```

**Step 4: Commit**

```bash
git add architecture.md product.md CLAUDE.md
git commit -m "docs(m6): update architecture, product spec, and CLAUDE.md for eval harness"
```

---

## Task 11: Update Linear Issues

**Step 1: Update existing M6 issues**

- Update `[Epic] Evaluation System` description with LangSmith integration details
- Update `Add trust-specific eval queries (t01-t07)` — mark t06/t07 as blocked on M5
- Update `Implement podcast rewrite trust checks` — blocked on M5

**Step 2: Create new Linear issues under M6**

- `Install eval dependencies (langsmith, tsx, dotenv)` — Task
- `Create 27 eval test queries (queries.json)` — Story
- `Implement source accuracy evaluator` — Story
- `Implement LLM-as-judge quality checklist evaluator` — Story
- `Implement efficiency, latency, and cost evaluators` — Story
- `Implement eval runner with LangSmith integration` — Story
- `Implement score aggregation and reporting` — Story
- `Add LangSmith tracing to agent service` — Story
- `Update docs for M6 eval harness` — Story

---

## Execution Order

```
Task 1  → Task 2  → Task 3  → Task 4  → Task 5  → Task 6  → Task 7  → Task 8  → Task 9  → Task 10 → Task 11
deps     queries    types     eval:src  eval:judge eval:eff  runner    scoring   tracing   docs      linear
```

All tasks are sequential — each builds on the previous.

## Verification

After all tasks, run the full eval:

```bash
# Start API in one terminal
npx nx serve api

# Run eval in another
npx tsx evals/run-eval.ts --provider groq

# Expected: 27 queries run, scored report printed, results saved to evals/results/
```

Check LangSmith dashboard for traces and experiment results.
