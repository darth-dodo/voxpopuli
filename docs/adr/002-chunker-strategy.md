# ADR-002: Chunker Strategy and Token Budget Design

**Status:** Accepted
**Date:** 2026-04-04
**Deciders:** Abhishek Juneja
**Linear:** AI-144

## Context

VoxPopuli's agent retrieves HN stories and comment threads, then feeds them to an LLM for synthesis. The three supported LLM providers have different context window sizes (Claude 200k, Mistral 262k, Groq 128k), and raw HN data -- especially deep comment trees -- can easily exceed any of them. HN comments also contain HTML markup that wastes tokens and confuses models.

The ChunkerService must solve three problems:

1. **Budget allocation**: Decide how many tokens of content to send to each provider, leaving room for the system prompt and agent reasoning overhead.
2. **Content prioritization**: When the content exceeds the budget, decide what to keep and what to drop.
3. **Token estimation**: Count tokens accurately enough to avoid truncation by the provider, without introducing heavy dependencies.

## Decision

### 1. Token budgets per provider

Each provider receives a conservative fraction of its total context window:

| Provider | Context Window | Content Budget | Headroom |
| -------- | -------------- | -------------- | -------- |
| Claude   | 200k           | 80k            | 60%      |
| Mistral  | 262k           | 100k           | 62%      |
| Groq     | 128k           | 50k            | 61%      |

The generous headroom accounts for: the agent's multi-turn conversation history growing across up to 7 ReAct steps, the LLM's own output tokens, and variance in token counting accuracy (see decision 5 below). Running near the context limit also degrades output quality on most models, so staying well below is intentional.

### 2. Reserved tokens for agent overhead

Before any content budgeting, the following tokens are subtracted from the content budget:

| Reservation        | Tokens | Rationale                                           |
| ------------------ | ------ | --------------------------------------------------- |
| System prompt      | 2,000  | Agent instructions, tool definitions, output format |
| Agent reasoning    | 2,000  | Multi-turn thought/action/observation history       |
| Per-step overhead  | 3,500  | 500 tokens x 7 max steps for tool calls and results |
| **Total reserved** | 7,500  |                                                     |

The effective content budget is therefore: provider budget minus 7,500 tokens. For Groq (the tightest), that leaves 42,500 tokens for HN content, which comfortably fits 3-4 stories with comments.

### 3. Content priority order

When filling the content budget, the chunker uses a greedy priority queue:

1. **Story metadata** (title, author, points, URL, date) -- always included. Costs ~50-100 tokens per story. Cheap and universally useful for citation.
2. **Story text** (selftext for Ask HN / Show HN posts) -- included next. Often contains the core question or project description.
3. **Top-level comments** (depth 0) -- highest signal-to-noise ratio. These are the most visible, most upvoted responses.
4. **Nested comments** (depth 1+) -- included last, in depth-first order. Deeper comments add nuance but diminishing returns set in quickly.

This order reflects how a human reader scans an HN thread: title first, then the post body, then top comments, then replies. It also aligns with the 30-comment cap per story -- at that limit, most comments are depth 0-1, which is where the highest-quality signal lives.

### 4. Truncation behavior

The chunker fills content greedily in priority order until the budget is exhausted. When any content is dropped:

- `ContextWindow.truncated` is set to `true`
- The agent's system prompt instructs it to note when context was truncated, so it can decide whether to fetch additional stories or comments
- Truncation happens at the chunk boundary (whole comments or stories), not mid-text, to avoid incoherent fragments

### 5. Token counting: character-based estimate for v1

Token counting uses a simple heuristic: **1 token is approximately 4 characters**.

| Approach        | Accuracy | Bundle Size | Speed     | Complexity |
| --------------- | -------- | ----------- | --------- | ---------- |
| tiktoken (Wasm) | ~99%     | +2-3 MB     | ~1ms/call | Moderate   |
| char / 4        | ~85-90%  | 0 KB        | <0.1ms    | Trivial    |

The character-based estimate is chosen for v1 because:

- The 60% headroom in token budgets absorbs the 10-15% estimation error comfortably
- It avoids a 2-3 MB Wasm dependency (tiktoken) in the backend bundle
- It is trivially fast, which matters when the chunker runs on every tool call within the agent loop
- If estimation error causes problems in practice, switching to tiktoken is a localized change in a single utility function

### 6. HTML stripping with code block preservation

HN comments contain HTML markup (`<p>`, `<a>`, `<i>`, etc.) that wastes tokens and can confuse the LLM. The chunker strips all HTML with two exceptions:

- `<code>` and `<pre>` blocks are preserved and converted to markdown code fences (triple backticks)
- This is critical because HN is a technical community -- code snippets in comments are often the most valuable content

The stripping pipeline:

1. Extract `<code>` and `<pre>` blocks, replace with placeholders
2. Strip all remaining HTML tags
3. Decode HTML entities (`&amp;` to `&`, `&#x27;` to `'`, etc.)
4. Restore code blocks as markdown fenced code
5. Collapse excessive whitespace

## Consequences

### Positive

- **Provider-agnostic content budgeting.** The same chunker works for all three providers; only the budget number changes.
- **Graceful degradation.** When content exceeds the budget, the most important information (metadata, top comments) is always retained.
- **Zero extra dependencies.** The character-based estimator adds no bundle weight or Wasm complexity.
- **Preserves technical signal.** Code blocks survive the HTML stripping process, keeping the highest-value content from HN comments intact.
- **Agent-aware truncation.** The agent knows when context was truncated and can compensate by fetching additional sources.

### Negative

- **Token estimate imprecision.** The char/4 heuristic can be off by 10-15%, which means the effective budget is somewhat less than advertised. This is acceptable given the headroom but reduces the usable content window.
- **Greedy filling is not optimal.** A short, high-signal nested comment might be dropped in favor of a longer, lower-signal top-level comment. Priority order is a heuristic, not a relevance score.
- **No cross-story deduplication.** If the same information appears in multiple threads (common for popular topics), the chunker includes it multiple times. The LLM handles deduplication in synthesis, but tokens are wasted.

### Risks

- **Headroom may be too generous for Groq.** At 50k of 128k, the effective content budget (42.5k after reservations) may not be enough for queries that need 4+ stories with comments. Mitigation: monitor truncation rates in the eval harness and adjust if needed.
- **Character-based estimate breaks on non-Latin text.** CJK characters and emoji are roughly 1 token per character, not 1 per 4. HN content is predominantly English, but comments with significant Unicode content will be over-counted. Mitigation: acceptable for v1; switch to tiktoken if the eval harness shows consistent budget underuse on international content.
- **HTML stripping may be too aggressive.** Stripping `<a>` tags loses URLs that could be valuable references. Mitigation: extract href values as plain text before stripping the tag.
