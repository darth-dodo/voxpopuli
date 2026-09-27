# ADR-009: Cutting Pipeline Latency by Generating Less

**Status:** Accepted
**Date:** 2026-09-27
**Deciders:** Abhishek Juneja
**Extends:** ADR-004 (ReAct agent), ADR-006 (adaptive query decomposition)

## Context

A multi-agent query (Retriever → Synthesizer → Writer) regularly took 60–120s end to end, and some
queries never finished. Before changing anything we measured where the time goes.

### How we measured

1. **SSE probe** against the running API — timestamps every `pipeline`/`action`/`observation`/`answer` event.
2. **In-process trace** — runs `OrchestratorService.runStream()` directly with a LangChain callback on the
   chat model that records wall time, input tokens and output tokens for _every_ LLM call.
3. **Raw provider check** — calls Mistral's REST API directly (no LangChain) to separate provider latency
   from our own overhead, and to read the rate-limit headers.
4. **Eval harness A/B** — the full query suite over SSE against two builds (original `HEAD` on :3101,
   this change on :3102), sequentially at concurrency 1 so Mistral's token-per-minute limit does not skew
   either side. See "Evaluation" below.

### Findings

Baseline trace for _"What does HN think about Rust for web backends?"_ (Mistral, 60.2s total):

| Phase                            | Time      | Output tokens | What it produced                                           |
| -------------------------------- | --------- | ------------- | ---------------------------------------------------------- |
| ReAct tool turns (3 LLM + tools) | 8.1s      | ~430          | tool calls — fine; `get_comments` alone took 3.1s          |
| **ReAct final turn**             | **14.2s** | **2,144**     | an 8 KB recap nobody reads (prompt asked for `"DONE"`)     |
| **Compaction**                   | **18.6s** | **3,810**     | themes **plus a re-typed metadata row for all 30 sources** |
| Synthesizer                      | 6.0s      | 889           | analysis                                                   |
| **Writer**                       | **13.2s** | **2,727**     | 8.9 KB of JSON for a 2.9 KB answer — sources copied again  |

1. **Latency is dominated by generated tokens, not the provider or the network.** A raw Mistral call returns
   in ~0.5s; decoding runs at roughly 150–200 tokens/s, so every 1k output tokens costs ~5–7s. Input tokens
   (even 18k) cost well under a second.
2. **The LLM was transcribing structured data.** The compactor prompt asked for an `allSources` table and
   the writer prompt said `"sources": [copy from the sources array in the input]`. That is thousands of
   output tokens copying titles/authors/points/URLs we already had as structured API data. The search tool
   output doesn't even include comment counts, so part of that table was invented.
3. **Transcription caused hard failures.** Ask HN posts have `url: null`; the model copied the `null`, the
   `SourceMetadataSchema` (`url: string`) rejected it twice, the Retriever threw, and `runWithFallback()`
   **re-ran the entire query with the legacy agent**. This is the >125s "never finishes" case we observed.
4. **The Retriever's "stop" turn was unbounded.** The prompt said "respond with DONE"; the model often wrote
   a 1–2k-token summary instead.
5. **Hitting the recursion limit was fatal.** When the model made one tool call per turn it exhausted the
   ReAct budget; `GraphRecursionError` propagated out of the Retriever and again triggered the full legacy
   re-run, discarding every tool result already collected.
6. **Comment trees were fetched sequentially.** `getCommentTree()` awaited each comment's replies one after
   another: roughly one Firebase round-trip _per comment_ (up to ~30) instead of one per depth level.
7. **Repair retries asked for fragments.** On a validation error the retry prompt said "Respond with valid
   JSON only"; the model returned only the corrected fragment, which failed again, and `withWriterFallback`
   re-ran the whole writer — three writer calls instead of one.
8. **Rate-limit pressure.** Mistral's limit on this key is 100k tokens/minute; a single baseline query used
   up to 159k input tokens. Any concurrency pushes queries into provider backoff.

Production (`voxpopuli-api.onrender.com`, checked 2026-09-27) showed the same shape: _"Is Bun
production-ready?"_ with `provider=mistral` took **120.9s** (retriever 84.2s, writer 33.3s). Separately,
**every production query with the default provider failed in <1s with `401 Invalid API Key`** (upstream
body `{"type":"invalid_request_error","code":"invalid_api_key"}`) — a deployment configuration issue, not
addressed by this ADR.

## Decision

Make the LLM generate only what requires judgement; have code do everything else. No new pipeline stages,
no model change.

| #   | Change                                                                                                                                                                                                                                                                 | Addresses |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **Source registry at the tool boundary.** `search_hn`/`get_story` record `SourceMetadata` into a per-request `SourceRegistry` (`agent/tools.ts`). Missing URLs fall back to the HN discussion link.                                                                    | 2, 3      |
| 2   | **Compactor emits `themes` only.** `allSources`, `totalSourcesScanned`, `tokenCount` are filled in by the Retriever node from the registry.                                                                                                                            | 2, 3      |
| 3   | **Writer emits prose only.** It parses `AgentResponseV2Schema.omit({ sources })`; the node attaches `bundle.allSources`.                                                                                                                                               | 2         |
| 4   | **Bounded ReAct stop turn.** Prompt: reply with exactly `DONE`, never summarize. Hard cap: the ReAct model is created with `maxTokens: 768` via a new optional `ModelOptions` on `LlmService.getModel()`. Compaction keeps the uncapped model.                         | 4         |
| 5   | **Batch tool calls.** Prompt asks for independent tool calls in a single turn (LangGraph's `ToolNode` already executes them concurrently), and forbids guessing story IDs.                                                                                             | 5         |
| 6   | **Recursion limit is not fatal.** The Retriever catches `GraphRecursionError` and compacts what it collected; other errors still propagate.                                                                                                                            | 5         |
| 7   | **Level-parallel comment trees.** `getCommentTree()` fetches one depth level at a time with all parents concurrent, then flattens depth-first with the same 30-comment cap. Replies already past the cap in the depth-0/1 ordering are pruned before fetching depth 2. | 6         |
| 8   | **Repair retries ask for the complete object.**                                                                                                                                                                                                                        | 7         |

### Eval harness

Latency is now a first-class eval output rather than only a banded score:

- `--stream` runs queries over `GET /api/rag/stream` (the path users hit). It bypasses the 10-minute
  `POST /rag/query` result cache and records time-to-first-event, per-stage elapsed and whether the pipeline
  fell back to the legacy agent.
- Reports carry raw `durationMs`/`timings` per query and a `summary.latency` block (mean/p50/p95, per-stage
  means, fallback count). Errored runs are excluded so fast failures don't look like fast answers.
- `--baseline <results.json>` prints the before/after change.

```bash
npx tsx evals/run-eval.ts -p mistral --multi-agent --stream -n 1                       # baseline
npx tsx evals/run-eval.ts -p mistral --multi-agent --stream -n 1 --baseline <file>     # compare
```

## Evaluation

Full query suite (25 active queries), Mistral, `--multi-agent --stream -n 1`, LLM judge enabled. Baseline
is commit `5719adc` (where this work started) built and served on :3101; the change is served on :3102;
same machine, run back to back. The change was later rebased onto `main`, whose intervening agent edits
(legacy-agent failure messages, tool input handling) don't touch the measured pipeline stages. Reports: `evals/results/2026-09-27T16-29-05-260Z-mistral.json` (before) and
`2026-09-27T16-39-50-855Z-mistral.json` (after).

**Latency**

| Metric                       | Before   | After  | Change     |
| ---------------------------- | -------- | ------ | ---------- |
| Mean                         | 43.7s    | 23.9s  | **−45.4%** |
| p50                          | 48.1s    | 23.6s  | **−51.0%** |
| p95                          | 68.9s    | 30.4s  | **−55.9%** |
| Retriever (mean)             | 31.0s    | 12.1s  | −61.0%     |
| Synthesizer (mean)           | 5.6s     | 5.5s   | −0.1%      |
| Writer (mean)                | 11.8s    | 6.2s   | −47.3%     |
| Legacy fallbacks             | 4/25     | 0/25   |            |
| Suite wall time (sequential) | 1,129.7s | 630.8s | −44.2%     |

**Quality and cost**

| Metric                        | Before | After  |
| ----------------------------- | ------ | ------ |
| Pass rate (weighted ≥ 0.6)    | 60%    | 92%    |
| Avg weighted score            | 0.65   | 0.70   |
| Source accuracy               | 0.96   | 1.00   |
| Quality checklist (LLM judge) | 0.79   | 0.81   |
| Mean estimated cost per query | $0.138 | $0.097 |
| Mean agent steps              | 14.6   | 13.4   |

The **efficiency** (0.13 → 0.04) and **cost** (0.11 → 0.01) _scores_ went down even though raw steps and
cost went down. Both scores are clipped bands (cost: `max(0, 1 − cost / $0.05)`), so most queries score 0
either way, and the baseline average was lifted by its 4 fallback runs: a failed pipeline's tokens and steps
aren't reported, so those runs looked cheap and short. Compare raw cost/steps, not these two scores.

All numbers are single runs per query; LLM tool-use varies run to run, so treat per-query differences as
noisy and the suite-level aggregates as the signal. The production spot check (_"Is Bun production-ready?"_,
120.9s on Render) vs. the same query locally after the change (18.8s) is directionally consistent but is not
a controlled comparison (different host, cold caches).

**Other providers and paths (E2E, isolated build).** Claude streamed all three stages to an answer;
`POST /rag/query` (Mistral) answered in 25.5s with 15 sources, none with a null URL; the web UI rendered an
answer in 27.5s with 16/16 sources verified by the trust bar; the server log had 0 schema/`Pipeline failed`
errors. OpenRouter (Qwen3 235B) is slow on _both_ builds — run concurrently on the same query, baseline
217.9s vs. this change 163.2s (−25%). Its time is in compaction/synthesis/writing with thinking tokens, not
the ReAct loop (tools done at ~16s), so OpenRouter model/host choice is the next lever for that provider.

## Consequences

**Positive**

- Fewer generated tokens per query, and fewer ways for a query to fall into the legacy-agent re-run.
- Source metadata is now exact (real comment counts, real URLs) instead of LLM-transcribed.
- Latency regressions are visible in every eval run, per stage.

**Negative / trade-offs**

- `allSources` lists every story the tools surfaced, not a list the LLM curated. In practice the LLM copied
  all of them anyway (29/30 in the baseline trace).
- The 768-token ReAct cap would truncate a tool-calling turn that needs more; the largest observed was
  ~350 tokens. If a provider needs longer reasoning before tool calls, raise
  `RETRIEVER_REACT_MAX_TOKENS` in `orchestrator.service.ts`.
- `getCommentTree()` issues more requests in parallel (bounded by 15 top-level × 3 replies × 3), which is
  heavier on the Firebase API per call but finishes in three round-trips.

## Alternatives considered

- **Faster/smaller model.** Orthogonal. Output-token volume is the multiplier regardless of model; fix
  that first, then compare providers with `--stream --baseline`.
- **Merge Synthesizer and Writer into one call.** Saves one round-trip (~5s) but changes the pipeline
  contract (ADR-004 / multi-agent design). Deferred; revisit with eval data.
- **Stream Writer tokens to the UI.** Improves perceived latency only; the frontend currently renders the
  final answer. Deferred.
- **Abort the ReAct stream when a non-tool message starts.** More precise than a token cap but
  provider-specific chunk parsing; the cap is simpler and provider-agnostic.

## Follow-ups (not in this change)

- Fix the production default-provider API key (every default query returns `401`).
- `summarizeToolOutput()` counts `by <author>` lines, but comments are formatted as
  `[Story N] author (depth d): ...`, so the UI shows "No comment content" even when comments were read.
