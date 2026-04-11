# ADR-006: Adaptive Query Decomposition in the Retriever Prompt

**Status:** Accepted
**Date:** 2026-04-11
**Deciders:** Abhishek Juneja
**Supersedes:** None (extends ADR-004)

## Context

VoxPopuli's Retriever agent uses a ReAct loop with 8 tool call iterations to search Hacker News, fetch stories, and read comments. The current system prompt gives generic guidance: "Start with 1-2 broad searches related to the query."

This works for focused queries ("Is Drizzle ORM production-ready?") but underperforms on three query types:

1. **Comparisons.** "Rust vs Go for backend services" needs separate searches for each side plus comparison posts. A single broad search returns results biased toward whichever term Algolia ranks higher.
2. **Multi-faceted questions.** "What does HN think about AI coding assistants?" has implicit sub-questions (quality, trust, workflow, pricing). A broad search covers 1-2 facets and misses the rest.
3. **Temporal questions.** "How has HN's opinion on crypto changed?" needs both date-sorted (recent) and relevance-sorted (canonical) searches. The current prompt doesn't guide the agent to use the `sort_by: 'date'` parameter strategically.

The eval harness (queries.json) has 8 comparison queries (q01-q05, q08) and 5 broad/temporal queries (q06-q07, q09-q10, q15) — nearly half the test suite exercises query types where the current prompt underperforms.

## Decision

Enhance the Retriever system prompt to include adaptive query decomposition guidance. No new pipeline stages, no new tools, no additional LLM calls.

### Approach: Prompt-only decomposition

The Retriever's system prompt is updated to instruct the ReAct agent to:

1. **Classify the query** before searching. Identify whether it is a comparison, multi-faceted question, temporal question, or focused question.
2. **Identify sub-queries.** List 2-4 search facets the query requires. For "Rust vs Go": `["Rust backend", "Go backend", "Rust vs Go"]`.
3. **Allocate iteration budget.** Distribute the 8-iteration cap across facets rather than spending it all on one broad search.
4. **Check coverage before stopping.** Before emitting "DONE", verify that all identified facets have at least some evidence.

### Query type strategies

| Query Type    | Detection Signal                                 | Strategy                                                                                                                   |
| ------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Comparison    | "vs", "or", "compared to", "versus"              | Search each entity separately, then search for direct comparisons. Fetch comments on the most-discussed thread per entity. |
| Multi-faceted | Broad "what does HN think about X"               | Identify 2-3 implicit dimensions (e.g., adoption, DX, performance). Search for each dimension + the topic.                 |
| Temporal      | "changed", "over time", "lately", "2024 vs 2025" | One relevance-sorted search (canonical opinions) + one date-sorted search (recent takes). Compare the two.                 |
| Focused       | Specific tool/technique + specific question      | 1-2 targeted searches + deep comment fetches. No decomposition needed.                                                     |

### What doesn't change

- **8-iteration cap.** The agent works within the same budget — it just allocates it more intelligently.
- **Pipeline stages.** No new nodes. Retriever → Compactor → Synthesizer → Writer is unchanged.
- **LLM calls.** The "classification" happens during the agent's first reasoning step (a thought), not a separate LLM call. Zero latency impact.
- **Tools.** The same three tools (`search_hn`, `get_story`, `get_comments`) are used. No new tool needed.
- **Types and interfaces.** No changes to `EvidenceBundle`, `AnalysisResult`, or any shared types.

### Alternatives considered

| Alternative                       | Pros                                                               | Cons                                                                                                                              | Decision                                |
| --------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Prompt-only (chosen)**          | Zero latency, zero code changes outside prompt, testable via evals | Relies on LLM following instructions; may not decompose perfectly                                                                 | Chosen — simplest approach, can iterate |
| **Planner node before Retriever** | Explicit decomposition, could parallelize sub-queries              | Adds 2-5s latency for an extra LLM call; more complex pipeline                                                                    | Rejected — latency cost too high        |
| **`decompose_query` tool**        | Observable decomposition step; testable as a tool call             | Over-engineering — the ReAct loop already reasons about search strategy; burns an iteration on a problem the LLM solves naturally | Rejected — YAGNI                        |
| **Parallel Retriever runs**       | Best coverage; each sub-query gets full iteration budget           | Multiplies LLM and API costs; requires bundle merging logic; significant latency increase                                         | Rejected — latency and cost prohibitive |

## Consequences

### Positive

- **Zero latency impact.** The agent uses the same 8 iterations and the same tools. The only change is how it allocates those iterations.
- **Improved eval scores.** Comparison and multi-faceted queries should produce more balanced evidence bundles, leading to better Synthesizer output and higher quality-judge scores.
- **Minimal blast radius.** Only `retriever.prompt.ts` changes. If the new prompt regresses, reverting is a single-file change.
- **Observable in SSE.** The agent's decomposition reasoning appears as `thought` events in the SSE stream, so users see the search plan.

### Negative

- **LLM compliance is not guaranteed.** The agent may ignore decomposition instructions, especially on simpler models (Groq). Mitigation: eval harness comparison queries catch regressions.
- **Budget pressure on complex queries.** A 4-facet comparison query might want 4 searches + 4 comment fetches = 8 iterations with no room for retries. Mitigation: the prompt guides the agent to prioritize — fetch comments only for the most-discussed threads, not all of them.

### Risks

- **Over-decomposition.** The agent might decompose simple queries unnecessarily, wasting iterations on redundant searches. Mitigation: the "Focused" query type explicitly says "no decomposition needed" — the agent should skip decomposition for straightforward queries.
- **Search result overlap.** Separate searches for "Rust backend" and "Go backend" may return the same "Rust vs Go" thread in both results. This is fine — the Compactor deduplicates by `sourceId` when building the `EvidenceBundle`.

## Validation

Run the eval harness before and after the prompt change to measure impact:

```bash
# Before (baseline)
npx tsx evals/run-eval.ts -C tool_comparison -p groq > evals/results/before-decomp.json

# After (with new prompt)
npx tsx evals/run-eval.ts -C tool_comparison -p groq > evals/results/after-decomp.json
```

**Success criteria:** Source count and quality-judge scores improve on comparison queries (q01-q05) without regressing on focused queries (q11-q14).
