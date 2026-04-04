# ADR-004: ReAct Agent Design and Tool Selection Strategy

**Status:** Accepted
**Date:** 2026-04-04
**Deciders:** Abhishek Juneja
**Linear:** AI-146

## Context

VoxPopuli answers complex questions about Hacker News content. A simple RAG pipeline (retrieve → generate) is insufficient because:

1. **Multi-faceted queries.** Users ask questions like "What do HN commenters think about React vs Vue in 2025?" -- this requires searching for multiple threads, reading comments across them, and synthesizing across sources. A single retrieval step cannot anticipate all the information needed.
2. **Adaptive search strategy.** Some queries need relevance-sorted results (best matches first), while others need date-sorted results (most recent takes). The system must decide which strategy to use -- and sometimes use both.
3. **Depth vs breadth decisions.** For a query like "Why did the Rust rewrite of X fail?", the agent might find a relevant story but need to dig into its comment tree for the actual analysis. A static pipeline cannot make this judgment call mid-execution.
4. **Variable information sufficiency.** Sometimes the first search returns everything needed; other times the agent must refine its query, fetch additional stories, or explore comment threads. The number of retrieval steps is query-dependent.

The agent module must orchestrate multi-step research workflows while respecting token budgets, concurrency limits, and response time constraints.

## Decision

### 1. LangChain's createReactAgent + AgentExecutor

VoxPopuli uses LangChain's `createReactAgent` factory and `AgentExecutor` runner rather than a hand-rolled ReAct loop or a graph-based orchestrator.

**Alternatives evaluated:**

| Option                      | Pros                                                                    | Cons                                                                       |
| --------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **LangChain AgentExecutor** | Built-in step limiting, timeout, error recovery; handles tool protocols | Less control over exact message flow; tied to LangChain's agent API        |
| **Hand-rolled ReAct loop**  | Full control over every message and tool invocation                     | Must maintain tool protocol compatibility across 3 providers (~500 lines)  |
| **Simple RAG (no loop)**    | Simplest implementation, lowest latency                                 | Cannot handle multi-step queries; single retrieval is often insufficient   |
| **LangGraph**               | State machines, conditional edges, human-in-the-loop                    | Significant complexity overhead for a 3-tool linear agent; overkill for v1 |

LangChain's AgentExecutor is chosen because:

- **Tool protocol delegation.** The primary complexity in a multi-provider ReAct loop is translating tool calls and results into each provider's native format (Claude's `tool_use`/`tool_result` blocks vs OpenAI-compatible `tool` role messages). LangChain already handles this -- see ADR-003.
- **ReAct is a natural fit.** The think → act → observe → repeat cycle maps directly to the research workflow: the agent reasons about what information it needs, calls a tool to get it, observes the result, and decides whether it has enough to answer.
- **Built-in operational controls.** AgentExecutor provides `maxIterations` (step limiting) and `maxExecutionTime` (timeout) out of the box. Reimplementing these correctly -- especially timeout with proper cleanup -- is non-trivial.
- **Error handling.** When a tool call fails (e.g., HN API timeout), AgentExecutor catches the error and passes it back to the model as an observation, allowing the agent to retry or adjust its approach. A hand-rolled loop must implement this recovery logic explicitly.

### 2. Tool design: three focused tools

The agent has exactly three tools, each corresponding to a distinct HN data access pattern:

#### `search_hn`

Searches HN via the Algolia API. Returns chunked story metadata (titles, scores, authors, dates, IDs).

```typescript
// Zod schema
z.object({
  query: z.string().describe('Search query for Hacker News stories'),
  sort_by: z.enum(['relevance', 'date']).default('relevance'),
  min_points: z.number().optional().describe('Minimum story points filter'),
  max_results: z.number().default(5).describe('Number of results to return'),
});
```

**Design rationale:** The `sort_by` parameter lets the agent choose between relevance (best match for topical queries) and date (most recent for "latest news" queries). `min_points` filters low-signal content. `max_results` controls how much of the token budget this single search consumes.

#### `get_story`

Fetches a single story by ID from the Firebase HN API. Returns the full story object (title, text, author, score, comment IDs).

```typescript
z.object({
  story_id: z.number().describe('Hacker News story ID'),
});
```

**Design rationale:** Separated from `search_hn` because search results contain only metadata. When the agent needs the full selftext of an Ask HN or Show HN post, it fetches the story individually. This avoids bloating search results with full story text that may not be needed.

#### `get_comments`

Fetches the comment tree for a story, with depth control and a 30-comment cap. Returns chunked comment text with author and nesting metadata.

```typescript
z.object({
  story_id: z.number().describe('Story ID to fetch comments for'),
  max_depth: z.number().default(2).describe('Maximum comment nesting depth'),
  max_comments: z.number().default(30).describe('Maximum comments to fetch'),
});
```

**Design rationale:** Comment fetching is the slowest operation in the system (each Firebase comment is an individual HTTP call). The `max_depth` parameter lets the agent control the depth-vs-breadth trade-off: shallow fetches (depth 1) are fast and capture top-level reactions, while deeper fetches capture nuanced discussions. The 30-comment cap is a hard constraint to prevent runaway fetch times.

### 3. Tool output format: chunked strings via ChunkerService

All tool implementations return their results as formatted strings produced by `ChunkerService.buildContext()`. This means:

- Tool outputs are already within the active provider's token budget (see ADR-002)
- HTML is stripped, code blocks are preserved as markdown
- Content is prioritized by signal value (metadata → story text → top comments → nested comments)
- The agent receives human-readable text, not raw JSON, which produces better reasoning

### 4. System prompt design

The agent receives a system prompt that defines:

- Its role (HN research assistant)
- Available tools and when to use each one
- Output format expectations (cite sources, note truncation, synthesize across sources)
- Constraints it must respect (step limit, comment cap)

The system prompt is static per request. It does not vary by provider -- LangChain handles provider-specific message formatting.

### 5. SSE streaming integration

The agent's intermediate steps (thoughts, tool calls, observations) are streamed to the frontend via Server-Sent Events. The `RagController` translates LangChain's stream events into VoxPopuli's SSE event types:

| LangChain Event | SSE Event Type | Content                    |
| --------------- | -------------- | -------------------------- |
| Agent thinking  | `thought`      | The agent's reasoning text |
| Tool invocation | `action`       | Tool name and parameters   |
| Tool result     | `observation`  | Chunked tool output        |
| Final answer    | `answer`       | Synthesized response       |
| Error           | `error`        | Error message              |

This mapping is implemented in the RagController, not in the agent module. The agent is unaware of SSE -- it produces a LangChain event stream, and the controller translates it.

## Safety Constraints

The agent operates within multiple safety boundaries:

| Constraint            | Value              | Enforcement                                    |
| --------------------- | ------------------ | ---------------------------------------------- |
| Max steps per run     | 7                  | `AgentExecutor.maxIterations`                  |
| Global timeout        | 60s                | `AgentExecutor.maxExecutionTime`               |
| Concurrent agent runs | 5                  | Semaphore in RagService                        |
| Comments per story    | 30                 | Hard cap in `get_comments` tool implementation |
| Token budget per tool | Provider-dependent | ChunkerService enforces per ADR-002            |
| Query max length      | 500 chars          | Input validation in RagController              |

**Step limit rationale.** 7 steps is enough for a typical research workflow: 1-2 searches + 1-2 story fetches + 1-2 comment fetches + final answer. Queries that need more than 7 steps are likely too broad and should be refined by the user. The limit also prevents token budget exhaustion from accumulated conversation history.

**Timeout rationale.** 60 seconds accommodates the worst case of 7 steps where each step includes a slow HN API call (~3-5s for comment tree fetching). It is aggressive enough to prevent zombie agent runs from consuming server resources.

**Semaphore rationale.** 5 concurrent agents limits the blast radius of traffic spikes. Each agent run can make dozens of HN API calls; without concurrency control, a burst of requests could trigger HN API rate limiting for all users.

## Consequences

### Positive

- **Rapid development.** The AgentExecutor handles the ReAct loop, step limiting, timeout, and error recovery. The agent module's core logic is under 150 lines -- mostly tool definitions and system prompt.
- **Provider-agnostic.** The same agent code runs against Claude, Mistral, and Groq without modification. Tool protocol translation is LangChain's responsibility (see ADR-003).
- **Battle-tested loop logic.** LangChain's AgentExecutor has been used in thousands of projects. Edge cases in the ReAct loop (tool call parsing failures, model refusals, empty responses) are handled by the library, not by custom code.
- **Clean separation of concerns.** The agent module defines tools and the system prompt. ChunkerService handles token budgeting. CacheService handles response caching. RagController handles SSE streaming. No single module is overloaded.
- **Observable execution.** The SSE streaming integration gives the frontend (and the developer) full visibility into the agent's reasoning process, which is critical for debugging and for the eval harness.

### Negative

- **LangChain dependency.** The agent module is coupled to LangChain's agent APIs (`createReactAgent`, `AgentExecutor`, `DynamicTool`). If LangChain introduces breaking changes in these APIs, the agent module must be updated. This risk is shared with the LLM provider layer (see ADR-003).
- **Less control over message formatting.** The exact messages sent to the LLM are constructed by LangChain's agent internals, not by VoxPopuli. If a provider produces better results with a specific prompt format (e.g., Claude performs better with XML-structured tool results), customizing this requires working around LangChain's abstractions.
- **Opaque debugging.** When the agent produces unexpected behavior (e.g., calling the same tool repeatedly, ignoring a tool result), diagnosing the issue requires understanding LangChain's internal state management, not just the provider's API.

### Risks

- **Step limit may be too restrictive for complex queries.** Some multi-topic queries (e.g., "Compare HN sentiment on Rust, Go, and Zig") could naturally require 3 searches + 3 comment fetches + answer = 7 steps exactly, leaving no room for retries. Mitigation: monitor step exhaustion rates in the eval harness and consider raising to 10 if needed.
- **Comment fetching dominates latency.** A single `get_comments` call with 30 comments can take 5-10 seconds due to serial Firebase API calls. An agent that calls `get_comments` three times could approach the 60-second timeout. Mitigation: parallel batching in HnService (fetch up to 5 comments concurrently), and the agent's system prompt encourages shallow comment fetches (depth 1) unless the query specifically needs deep discussion threads.
- **Tool output truncation confuses the model.** When ChunkerService truncates tool output to fit the token budget, the model sees a `[truncated]` marker but may not understand what was cut. It might re-fetch the same content expecting different results. Mitigation: the truncation metadata includes the original count vs. included count (e.g., "Showing 15 of 47 comments"), giving the model enough information to decide whether to adjust its strategy.
