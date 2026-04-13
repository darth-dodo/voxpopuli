# Adaptive Query Decomposition — Design

**Goal:** Improve evidence coverage on comparison, multi-faceted, and temporal queries by upgrading the Retriever's system prompt to decompose queries into facets and allocate its iteration budget accordingly.

**ADR:** [006-adaptive-query-decomposition](../adr/006-adaptive-query-decomposition.md)

**Approach:** Prompt-only enhancement to `apps/api/src/agent/prompts/retriever.prompt.ts`. No new nodes, tools, types, or LLM calls.

## What Changes

**Single file:** `apps/api/src/agent/prompts/retriever.prompt.ts`

The updated prompt adds three sections to the Retriever's system prompt:

### 1. Query Analysis (new)

Before searching, the agent classifies the query and lists sub-queries:

```
## QUERY ANALYSIS (do this FIRST)
Before making any tool calls, analyze the query:
1. Classify: comparison | multi-faceted | temporal | focused
2. List 2-4 search facets (sub-queries you need evidence for)
3. Plan your iteration budget (you have 8 tool calls total)
```

### 2. Strategy per query type (replaces current generic "1-2 broad searches")

```
## SEARCH STRATEGY BY QUERY TYPE

### Comparison ("A vs B", "A or B")
- Search for A specifically (1 search)
- Search for B specifically (1 search)
- Optionally search "A vs B" for direct comparisons (1 search)
- Fetch comments on the most-discussed thread per side (2 fetches)
- Budget: 3 searches + 2 comment fetches = 5 iterations

### Multi-faceted ("What does HN think about X?")
- Identify 2-3 dimensions (e.g., DX, performance, adoption)
- Search "X <dimension>" for each (2-3 searches)
- Fetch comments on the highest-signal thread (1-2 fetches)
- Budget: 2-3 searches + 1-2 comment fetches = 4-5 iterations

### Temporal ("How has X changed?", "X in 2025")
- Search by relevance for canonical opinions (1 search)
- Search by date for recent takes (1 search, sort_by: date)
- Fetch comments on one old + one new thread (2 fetches)
- Budget: 2 searches + 2 comment fetches = 4 iterations

### Focused ("Is X production-ready?", specific question)
- 1-2 targeted searches (1-2 searches)
- Fetch comments on the most relevant thread (1-2 fetches)
- Budget: 1-2 searches + 1-2 comment fetches = 3-4 iterations
```

### 3. Coverage check (new, replaces "stop when you have enough")

```
## BEFORE STOPPING
Review your identified facets. For each one:
- Do you have at least one relevant source?
- If a facet has zero evidence, try one more targeted search.
- If you've used 6+ iterations and still have gaps, stop — the Synthesizer will flag gaps honestly.
```

## What Doesn't Change

- Iteration cap (8), tools, pipeline stages, types, latency
- Compactor, Synthesizer, Writer prompts
- Node functions, orchestrator, SSE events

## Testing

- **Unit test:** Verify the prompt string contains the new sections (structural test)
- **Eval harness:** Before/after comparison on `tool_comparison` category queries
- **Success criteria:** Source count and quality-judge scores improve on q01-q05 without regressing on q11-q14
