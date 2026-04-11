# Eval Lessons Learned

Observations and patterns from running the VoxPopuli eval harness. Updated as new runs reveal insights.

## 2026-04-11 — Mistral + Adaptive Query Decomposition (ADR-006)

**Run:** `2026-04-11T19-54-15-277Z-mistral.json`
**Provider:** Mistral | **Pass rate:** 44% (11/25) | **Avg weighted:** 0.52

### What Worked

**Comparison queries benefit from decomposition.** q01 (Rust vs Go) and q02 (React vs Svelte) both scored 0.78 with source=1.0 and quality=1.0. The Retriever searched both sides independently, producing balanced evidence bundles. This validates the ADR-006 prompt-only approach.

**Focused queries are reliable.** q04 (Drizzle ORM), q11 (Hetzner), q16 (anti-microservices), q17 (system design books) all scored 0.75+. Single-topic queries with clear search terms consistently find sources and produce quality answers.

**Edge cases handled gracefully.** q19 (nonsense query "xyzzy florbnog garbanzo") scored 0.69 — the agent correctly acknowledges no results without hallucinating. Fast at 3.2s since it exits early.

### Known Failure Patterns

#### Pattern 1: Fast Failures (6-7s, 0 sources)

**Affected:** q03 (Bun vs Deno vs Node), q05 (Tailwind vs CSS), q18 (controversial interview posts)

**Symptom:** Response returns in 6-7s with zero sources. The Retriever likely finds no Algolia results for the search terms used.

**Root cause hypothesis:** The Algolia HN API may not index these terms well, or the agent's search terms are too specific. "Bun vs Deno vs Node" as a single search may not match HN titles.

**Potential fix:** The adaptive decomposition prompt should help here — searching "Bun runtime", "Deno backend", "Node.js 2026" separately. If these queries still fail after the prompt change, the search terms in queries.json may need adjustment, or `min_points` filtering is too aggressive.

#### Pattern 2: API Errors (5ms, ERR)

**Affected:** q08 (coding bootcamps), q09 (crypto in 2026), q12 (SaaS with SQLite)

**Symptom:** Errors in <5ms — the request fails before the agent even starts.

**Root cause hypothesis:** Likely a pipeline-level error (validation, timeout config, or provider issue). The 5ms timing suggests the error happens at the controller or orchestrator level, not in the LLM.

**Action needed:** Run these individually with verbose logging to identify the failure point:

```bash
npx tsx evals/run-eval.ts -q q08 -p mistral
```

#### Pattern 3: Latency Scores Are 0.0

**Affected:** All passing queries except edge cases

**Symptom:** Most successful queries take 40-90s, far above Mistral's "excellent" threshold of 10s. Even the "acceptable" threshold of 30s is only met by fast-fail queries.

**Root cause:** The multi-agent pipeline (Retriever ReAct loop + Compaction + Synthesizer + Writer) inherently takes 40-90s with Mistral. Each pipeline stage makes 1+ LLM calls, and the Retriever's ReAct loop adds 3-6 calls on top.

**Implications:** The latency thresholds in `evaluators/latency.ts` were set for the legacy single-agent path. With the pipeline, they need recalibration:

- Current Mistral thresholds: 10s / 20s / 30s
- Realistic pipeline thresholds: 30s / 60s / 90s

**Decision:** Either recalibrate thresholds for pipeline mode, or accept that latency scores will be low until pipeline optimization work (parallel stages, streaming, caching).

#### Pattern 4: Sources Found But Quality = 0.0

**Affected:** t01 (Rust vs Go trust), q06 (remote work), q10 (Turso), q15 (LLM costs)

**Symptom:** Source accuracy is 1.0 (sources verified) but quality checklist is 0.0. The agent finds relevant content but the answer doesn't satisfy `expectedQualities`.

**Root cause hypothesis:** The pipeline may be producing structurally valid responses (correct headline/sections format) that miss the specific qualities the judge looks for. For example, t01 expects `viewpointDiversity is 'balanced' or 'contested'` — if the trust metadata isn't being checked by the judge, this will fail.

**Action needed:** Inspect the quality-judge prompts and verify the `expectedQualities` are realistically checkable from the answer text alone.

### Scoring Observations

| Dimension       | Average | Notes                                              |
| --------------- | ------- | -------------------------------------------------- |
| Source Accuracy | 0.56    | Good when agent finds results; binary (1.0 or 0.0) |
| Quality         | 0.57    | Highest variance — depends on judge + qualities    |
| Efficiency      | 0.61    | Most queries within step budget                    |
| Latency         | 0.25    | Pipeline is too slow for current thresholds        |
| Cost            | 0.49    | Mistral is mid-range; Groq would be cheaper        |

**Biggest lever for improving pass rate:** Fix the latency thresholds for pipeline mode. Moving Mistral's thresholds from 10/20/30s to 30/60/90s would flip latency scores from 0.0 to 0.6-1.0 for most passing queries, pushing borderline queries (0.44-0.48) above the 0.60 threshold.

### Recommendations

1. **Investigate q08/q09/q12 errors** — these are likely fixable bugs, not content issues
2. **Recalibrate latency thresholds** — current values assume single-agent, not pipeline
3. **Re-run comparison queries** — verify q03/q05 improve with adaptive decomposition
4. **Run Groq comparison** — faster inference may improve latency scores significantly
5. **Consider `--no-judge` for iteration** — quality-judge adds latency to the eval run itself; use `--no-judge` for quick iteration, full scoring for baselines
