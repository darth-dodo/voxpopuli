# VoxPopuli — Product Specification

**Version:** 1.1.0
**Status:** Draft (Revised)
**Last Updated:** March 31, 2026

> *"Vox Populi, Vox Dei."* -- The voice of the people is the voice of God.

---

## Revision Log

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2026-03-31 | Native tool_result protocol; caching + rate limiting promoted to v1.0; comment cap reduced to 30; eval harness added; latency targets revised; triple-stack LLM provider (Claude + Mistral + Groq) |
| 1.0.0 | 2026-03-31 | Initial draft |

---

## 1. What is VoxPopuli?

VoxPopuli is an **agentic RAG (Retrieval-Augmented Generation) system** that turns Hacker News into a queryable knowledge base. Ask a question in natural language. The agent searches HN stories, crawls comment threads, reasons about what it finds, and delivers a sourced, synthesized answer -- with full transparency into its reasoning process.

It is not a chatbot wrapper. It is an autonomous research agent that decides what to search, what to read deeper, and when it has enough to answer.

**One-liner:** _"Ask anything. Get the internet's smartest crowd-sourced answer, with receipts."_

---

## 2. Why This Exists

### The Problem

Hacker News has 18+ years of high-signal technical discussion from engineers, founders, researchers, and domain experts. But accessing that knowledge is painful:

- **Algolia search is keyword-only.** No semantic understanding. "Best database for time-series" and "storing sensor data efficiently" return completely different results for the same question.
- **Comments are buried.** The best insights are 3 levels deep in a 400-comment thread. Nobody has time to read all of that.
- **No synthesis.** Even if you find 5 relevant threads, YOU have to be the one connecting the dots across them.
- **No memory.** Every search session starts from zero. There is no continuity.

### The Opportunity

LLMs can now reason over retrieved context. Combine that with HN's structured API and you get something that didn't exist before: an agent that reads HN the way a senior engineer would -- strategically, critically, and across multiple sources -- but in seconds instead of hours.

### Who Is This For?

| Persona | Use Case |
|---------|----------|
| **Engineers** choosing tools | "What does HN think about Bun vs Deno in 2026?" |
| **Founders** validating ideas | "Has anyone built a competitor to X? What was the reception?" |
| **Researchers** tracking discourse | "How has sentiment on LLM agents changed over the past year?" |
| **Job seekers** | "What companies is HN excited about hiring at right now?" |
| **Curious humans** | "What's the most controversial HN post about remote work?" |

---

## 3. Core Capabilities

### 3.1 Intelligent Search

The agent doesn't just forward your query to Algolia. It **reformulates** the query based on what it's looking for, adjusts filters (date range, minimum points, tags), and may run multiple searches to triangulate an answer.

**Example:**

```
User: "Is SQLite good enough for production web apps?"

Agent internally:
  Step 1: search_hn("SQLite production web app", min_points: 50)
  Step 2: search_hn("SQLite scaling limitations", sort: date)
  Step 3: get_comments(story_id: 38543832)  // highest-signal thread
  Step 4: Synthesize answer from 3 sources + 28 comments
```

### 3.2 Deep Comment Thread Analysis

Comments are where the real knowledge lives. The agent:

- Fetches comment trees up to 3 levels deep (max 5 on explicit request).
- Strips HTML, preserves code blocks.
- Prioritizes shallow (high-visibility) comments first.
- **Hard cap: 30 comments per story** to control latency and token budget.
- Fits everything into a token budget without losing critical context.

**Why 30, not 50 or 100?** Each Firebase comment fetch is an individual HTTP call. A 400-comment thread means 400 requests. At 30 comments (top-level + high-signal nested), we get the best signal-to-noise ratio while keeping comment fetch time under 3 seconds. The agent can always fetch comments from multiple stories if it needs broader coverage.

### 3.3 Agentic Reasoning (ReAct Loop)

The agent follows the **ReAct** pattern (Yao et al., 2022):

```
THINK  ->  "I need opinions from practitioners, not just blog posts."
ACT    ->  get_comments(story_id: 39201844)
OBSERVE -> 28 comments fetched. Top comment discusses migration pain.
THINK  ->  "I have search results + comments. Enough to answer."
RESPOND -> Synthesized answer with citations.
```

Every step is logged and exposed to the frontend. Full transparency. No black box.

Source: [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)

### 3.4 Sourced Answers

Every claim in the agent's response traces back to a specific HN story or comment. The response includes:

- Story title, author, and point count
- Direct links to HN threads
- Commenter usernames for attributed opinions

No hallucination. If the agent can't find it, it says so.

### 3.5 Live Reasoning Visualization

The frontend streams the agent's thinking process in real time via Server-Sent Events (SSE). Users see:

- Each reasoning step as it happens
- Which tools are being called and why
- Expandable raw results
- The final answer with source cards

This isn't just a UX feature. It's a trust mechanism.

### 3.6 Response Caching

**Promoted from v1.1 to v1.0 scope.**

Every query hits both external APIs and the LLM. Without caching, identical queries burn tokens and latency for no reason. v1.0 ships with a two-layer cache:

**Layer 1: HN Data Cache (node-cache, in-memory)**

| Data | TTL | Reason |
|------|-----|--------|
| Algolia search results | 15 minutes | Stories don't change fast, but new ones appear |
| Firebase items (stories) | 1 hour | Story metadata is stable |
| Firebase items (comments) | 30 minutes | Comments are semi-stable, but new ones arrive |

**Layer 2: Query Result Cache**

| Data | TTL | Reason |
|------|-----|--------|
| Full AgentResponse by query hash | 10 minutes | Identical queries within a short window get instant results |

Cache keys are deterministic hashes of the query + options. Cache is invalidated on TTL expiry only (no manual invalidation in v1).

Source: [node-cache docs](https://www.npmjs.com/package/node-cache)

### 3.7 Rate Limiting

**Promoted from v1.1 to v1.0 scope.**

The API is rate-limited from day one to prevent accidental cost blowouts and abuse.

| Scope | Limit | Implementation |
|-------|-------|----------------|
| Per-IP query rate | 10 requests/minute | express-rate-limit middleware |
| Global query rate | 60 requests/minute | In-memory counter |
| Max concurrent agent runs | 5 | Semaphore in AgentService |

Source: [express-rate-limit docs](https://www.npmjs.com/package/express-rate-limit)

---

## 4. Architecture

### 4.1 High-Level Overview

```
+---------------------------------------------------------+
|                   Angular (web)                          |
|                                                          |
|  +---------+  +--------------+  +----------------+      |
|  | Chat UI |  | Agent Steps  |  | Source Cards    |     |
|  |         |  | (live viz)   |  |                 |     |
|  +----+----+  +------+-------+  +-------+--------+     |
+-------+--------------+------------------+---------------+
        |              |                  |
        +--------------+------------------+
                       | SSE / HTTP
+----------------------+--------------------------------------+
|                   NestJS (api)                               |
|                                                              |
|  +------------------------------------------------------+   |
|  |              RAG Controller                           |   |
|  |   POST /api/rag/query    (full response)              |   |
|  |   GET  /api/rag/stream   (SSE streaming)              |   |
|  +---------------------------+---------------------------+   |
|                              |                               |
|  +---------------------------+---------------------------+   |
|  |              Agent Service (ReAct Loop)                |  |
|  |                                                        |  |
|  |   +----------+  +----------+  +--------------+        |  |
|  |   |  THINK   |->|  ACT     |->|  OBSERVE     |       |  |
|  |   |          |  | (tool)   |  | (parse)      |       |  |
|  |   +----------+  +----------+  +--------------+        |  |
|  |        ^                            |                  |  |
|  |        +----------------------------+                  |  |
|  |              Loop until done (max 7)                   |  |
|  +--------------------------------------------------------+  |
|                     |                                        |
|     +---------------+---------------+                        |
|     v               v               v                        |
|  +--------+  +----------+  +------------------+             |
|  |HN API  |  | Chunker  |  | LLM Provider     |            |
|  |Service |  | Service  |  | (interface)       |            |
|  |+ Cache |  |          |  |                   |            |
|  +---+----+  +----------+  +--+-----+-----+---+            |
|      |                        |     |     |                  |
|      |                  Claude  Mistral  Groq                |
+------+-------------------------------------------------------+
       |
       +-->  HN Algolia API (search)
       +-->  HN Firebase API (items + comments)
```

### 4.2 Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Monorepo** | Nx | Shared types, unified builds, dependency graph |
| **Backend** | NestJS (Node.js) | Modular DI, first-class TypeScript, SSE support |
| **Frontend** | Angular 17+ | Standalone components, signals, SSE via EventSource |
| **LLM (production)** | Claude (Anthropic API) | Best synthesis quality, 200k context |
| **LLM (cost-optimized)** | Mistral Large 3 | 262k context, $0.50/$1.50 per M tokens |
| **LLM (speed/dev)** | Groq (Llama 3.3 70B) | 300+ t/s inference, free tier for dev |
| **Caching** | node-cache (in-memory) | Zero-infrastructure, sufficient for single-node v1 |
| **Shared Types** | TypeScript library | Single source of truth for API contracts |
| **Data Sources** | HN Algolia + Firebase APIs | Full-text search + structured item/comment data |

### 4.3 Module Dependency Graph

```
AppModule
+-- ConfigModule (global)
+-- CacheModule
|   +-- CacheService (node-cache wrapper, TTL management)
+-- HnModule
|   +-- HnService
|       +-- Algolia HTTP client (search, search_by_date)
|       +-- Firebase HTTP client (getItem, getCommentTree, getTopStoryIds)
|       +-- CacheService (injected, wraps all external calls)
+-- ChunkerModule
|   +-- ChunkerService
|       +-- chunkStories()     -> StoryChunk[]
|       +-- chunkComments()    -> CommentChunk[]
|       +-- buildContext()     -> ContextWindow (token-budgeted)
|       +-- formatForPrompt()  -> string
+-- LlmModule
|   +-- LlmProviderInterface (abstract)
|   +-- ClaudeProvider (implements LlmProviderInterface)
|   +-- MistralProvider (implements LlmProviderInterface)
|   +-- GroqProvider (implements LlmProviderInterface)
|   +-- LlmService (facade, delegates to active provider)
+-- AgentModule
|   +-- AgentService
|       +-- run()          -> AgentResponse
|       +-- executeTool()  -> tool results
|       +-- imports: HnModule, ChunkerModule, LlmModule
+-- RagModule
    +-- RagController
        +-- POST /api/rag/query
        +-- GET  /api/rag/stream (SSE)
        +-- imports: AgentModule
```

---

## 5. LLM Provider Architecture

### 5.1 Why Triple-Stack?

No single LLM wins on every axis. Different stages of the project need different things:

| Stage | Best Provider | Why |
|-------|--------------|-----|
| **Development** | Groq (Llama 3.3 70B) | Free tier, 300+ t/s speed, instant feedback loops |
| **Testing/CI** | Groq or Mistral | Cheap, fast, good enough for regression detection |
| **Cost-optimized prod** | Mistral Large 3 | Best quality-per-dollar, 262k context |
| **Quality-optimized prod** | Claude (Sonnet 4) | Best multi-source synthesis, strongest agent reasoning |

### 5.2 Provider Comparison

| Factor | Claude (Sonnet 4) | Mistral Large 3 | Groq (Llama 3.3 70B) |
|--------|-------------------|------------------|-----------------------|
| **Context window** | 200k | 262k | 128k |
| **Output speed** | ~50 t/s | ~80 t/s | 300+ t/s |
| **Input pricing** | ~$3.00/M | $0.50/M | ~$0.59/M |
| **Output pricing** | ~$15.00/M | $1.50/M | ~$0.79/M |
| **Est. cost/query** | $0.02-0.08 | $0.003-0.015 | $0.004-0.016 |
| **Tool calling** | Native (tool_use blocks) | Native (OpenAI-compatible) | Native (OpenAI-compatible) |
| **Free tier** | No | Limited | Yes (1,000 req/day for Llama 3.3) |
| **Synthesis quality** | Excellent | Strong | Good |
| **Agent reasoning** | Excellent | Strong | Adequate |
| **API format** | Anthropic SDK | Mistral SDK / OpenAI-compat | OpenAI-compatible |

### 5.3 Provider Interface

All three providers implement a common TypeScript interface:

```typescript
export interface LlmProviderInterface {
  readonly name: string;
  readonly maxContextTokens: number;

  chat(
    messages: LlmMessage[],
    options: ChatOptions
  ): Promise<LlmResponse>;

  /**
   * Convert tool definitions from our internal format
   * to the provider's expected format.
   */
  formatTools(tools: ToolDefinition[]): unknown[];

  /**
   * Build a proper tool_result message from a tool execution.
   * Claude uses tool_use/tool_result content blocks.
   * Mistral/Groq use OpenAI-style tool role messages.
   */
  buildToolResultMessage(
    toolCallId: string,
    result: string
  ): LlmMessage;
}
```

**Key design choice:** The `buildToolResultMessage` method ensures each provider uses its **native tool result protocol** instead of string-hacking results into assistant messages. This was a critical revision from v1.0.

| Provider | Tool Result Format |
|----------|-------------------|
| **Claude** | `tool_result` content block with `tool_use_id` reference |
| **Mistral** | `role: "tool"` message with `tool_call_id` (OpenAI-compatible) |
| **Groq** | `role: "tool"` message with `tool_call_id` (OpenAI-compatible) |

Source: [Anthropic > Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use), [Mistral > Function Calling](https://docs.mistral.ai/capabilities/function_calling), [Groq > Local Tool Calling](https://console.groq.com/docs/tool-use/local-tool-calling)

### 5.4 Provider Selection

Configured via `.env`:

```env
# Options: claude, mistral, groq
LLM_PROVIDER=groq

# Provider-specific keys (only the active provider's key is required)
ANTHROPIC_API_KEY=sk-ant-...
MISTRAL_API_KEY=...
GROQ_API_KEY=gsk_...
```

The `LlmModule` reads `LLM_PROVIDER` at startup and instantiates the correct provider. Switching providers requires zero code changes. Users can also override per-request via the `provider` query parameter.

---

## 6. Data Flow

### 6.1 Single Query Lifecycle

```
1. User types: "What does HN think about Tailwind v4?"
                    |
2. Angular sends:   POST /api/rag/query
                    |             OR
                    GET /api/rag/stream?query=...  (SSE)
                    |
3. RagController receives request
   +-- Rate limiter checks (10 req/min per IP)
   +-- Query cache check (hit? return cached AgentResponse)
                    |
4. AgentService.run() starts the ReAct loop:
   |
   +-- Step 1: LLM decides -> search_hn("Tailwind v4")
   |  +-- CacheService check (miss -> Algolia API -> cache result)
   |  +-- HnService.search() -> 10 hits
   |  +-- ChunkerService.chunkStories() -> StoryChunk[]
   |  +-- Build native tool_result message for provider
   |  +-- Feed back to LLM
   |
   +-- Step 2: LLM decides -> get_comments(story_id: 39482731)
   |  +-- CacheService check per item (mix of hits/misses)
   |  +-- HnService.getCommentTree() -> 30 comments (capped)
   |  +-- ChunkerService.chunkComments() -> CommentChunk[]
   |  +-- Build native tool_result message for provider
   |  +-- Feed back to LLM
   |
   +-- Step 3: LLM decides -> search_hn("Tailwind CSS criticisms")
   |  +-- (same flow as Step 1)
   |
   +-- Step 4: LLM has enough -> generates final answer
                    |
5. AgentResponse returned + cached (TTL: 10 min):
   {
     answer: "HN is broadly positive on Tailwind v4, with...",
     steps: [ ...4 reasoning steps... ],
     sources: [ ...deduplicated story list... ],
     meta: { provider: "groq", totalTokens: 24500, durationMs: 6200 }
   }
                    |
6. Angular renders:
   +-- Agent steps timeline (expandable)
   +-- Answer text with inline citations
   +-- Source cards with links to HN threads
   +-- Meta bar: provider used, tokens consumed, time taken
```

### 6.2 Token Budget Management

The Chunker enforces a strict token budget. The budget varies by provider:

```
Claude context:     200,000 tokens -> budget: 80,000 (conservative)
Mistral context:    262,000 tokens -> budget: 100,000
Groq context:       128,000 tokens -> budget: 50,000

Reserved (all providers):
  System prompt:      2,000 tokens
  Agent reasoning:    2,000 tokens
  Per-step overhead:    500 tokens x max_steps

Priority order:
  1. Story metadata (title, author, points)  -- always included
  2. Story text (Ask HN / Show HN bodies)    -- included if fits
  3. Top-level comments (depth 1)            -- highest priority
  4. Nested comments (depth 2-3)             -- if budget remains
  5. Truncation flag set if anything dropped
```

### 6.3 Comment Fetching Strategy

**Changed in v1.1: Hard cap reduced from 50 to 30.**

Each Firebase comment is an individual HTTP call. Fetching strategy:

```
1. Fetch parent story -> get kids[] (top-level comment IDs)
2. Sort kids by position (first = highest on page = most visible)
3. Fetch top 15 top-level comments (parallel, batches of 10)
4. For each top-level comment with kids[], fetch up to 3 replies
5. Total cap: 30 comments regardless of tree shape
6. Skip deleted/dead comments (don't count toward cap)
```

**Worst-case HTTP calls:** 30 individual + 1 parent = 31 calls
**Worst-case latency:** ~3 seconds (batched, parallel)
**Best-case (cached):** < 100ms

---

## 7. API Specification

### 7.1 POST `/api/rag/query`

Standard request-response. Blocks until the agent completes all steps.

**Request:**

```typescript
{
  query: string;              // Required. Natural language question.
  maxSteps?: number;          // Optional. Default: 5. Max: 7.
  includeComments?: boolean;  // Optional. Default: true.
  provider?: string;          // Optional. Override LLM provider for this query.
}
```

**Response:**

```typescript
{
  answer: string;             // The synthesized answer
  steps: AgentStep[];         // Full reasoning chain
  sources: AgentSource[];     // Deduplicated story sources
  meta: {
    provider: string;         // Which LLM was used
    totalInputTokens: number;
    totalOutputTokens: number;
    durationMs: number;
    cached: boolean;          // True if served from query cache
  }
}
```

**Error Responses:**

| Status | Condition |
|--------|-----------|
| 400 | Empty or missing `query` |
| 429 | Rate limit exceeded |
| 500 | Agent execution failure (LLM error, API timeout) |

### 7.2 GET `/api/rag/stream`

Server-Sent Events endpoint. Streams reasoning steps in real time.

**Query Parameters:**

```
?query=...&maxSteps=5&includeComments=true&provider=groq
```

**Event Types:**

| Event | Payload | When |
|-------|---------|------|
| `thought` | `AgentStep` | Agent is reasoning |
| `action` | `AgentStep` (with tool call) | Agent is calling a tool |
| `observation` | `AgentStep` (with result) | Tool returned data |
| `answer` | `AgentResponse` | Final answer ready |
| `error` | `string` | Something broke |

### 7.3 GET `/api/health`

Health check endpoint. Returns provider status and cache stats.

```typescript
{
  status: "ok";
  provider: string;
  cacheStats: { hits: number; misses: number; keys: number };
  uptime: number;
}
```

---

## 8. Agent Tool Specifications

The agent has access to three tools. The LLM decides which to call and in what order.

### 8.1 `search_hn`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search keywords |
| `sort_by` | `"relevance"` \| `"date"` | No | Default: relevance |
| `min_points` | number | No | Filter low-quality stories |
| `max_results` | number | No | 1-20, default 10 |

**Behavior:** Calls HN Algolia `/search` or `/search_by_date`. Results pass through CacheService (TTL: 15 min), then are chunked and token-counted before returning to the agent.

### 8.2 `get_story`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `story_id` | number | Yes | HN item ID |

**Behavior:** Calls HN Firebase `/item/{id}.json`. Cached for 1 hour. Returns full item data.

### 8.3 `get_comments`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `story_id` | number | Yes | Parent story ID |
| `max_depth` | number | No | 1-5, default 3 |

**Behavior:** Recursively fetches comment tree via Firebase. Individual items cached for 30 min. Strips HTML, assigns depth levels, **caps at 30 comments**. Fetches in parallel batches of 10.

---

## 9. Native Tool Use Protocol

**This section documents a critical v1.1 revision.**

v1.0 spec hacked tool results into string-concatenated assistant messages. This degrades reasoning quality because the model can't distinguish tool results from its own prior output. v1.1 uses each provider's **native tool result protocol**.

### 9.1 Claude (Anthropic)

Claude uses structured content blocks within the messages array:

```typescript
// Agent decides to call a tool -> Claude returns:
{
  role: "assistant",
  content: [
    { type: "text", text: "I'll search for relevant stories." },
    { type: "tool_use", id: "toolu_01abc", name: "search_hn",
      input: { query: "Tailwind v4" } }
  ]
}

// We execute the tool, then send back:
{
  role: "user",
  content: [
    { type: "tool_result", tool_use_id: "toolu_01abc",
      content: "[...chunked results...]" }
  ]
}
```

Source: [Anthropic > Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)

### 9.2 Mistral and Groq (OpenAI-compatible)

Both use the `tool` role message format:

```typescript
// Model returns tool call in response:
{
  role: "assistant",
  tool_calls: [{
    id: "call_abc123",
    type: "function",
    function: {
      name: "search_hn",
      arguments: '{"query":"Tailwind v4"}'
    }
  }]
}

// We execute the tool, then send back:
{
  role: "tool",
  tool_call_id: "call_abc123",
  content: "[...chunked results...]"
}
```

Source: [Mistral > Function Calling](https://docs.mistral.ai/capabilities/function_calling), [Groq > Local Tool Calling](https://console.groq.com/docs/tool-use/local-tool-calling)

### 9.3 Why This Matters

Using native protocols gives the model clear separation between its own reasoning and external data. In testing, this produces:

- More accurate tool selection on steps 2+
- Fewer hallucinated tool arguments
- Better synthesis when multiple tool results are in context

---

## 10. Project Structure

```
voxpopuli/
+-- apps/
|   +-- api/                              # NestJS backend
|   |   +-- src/
|   |       +-- agent/
|   |       |   +-- agent.module.ts
|   |       |   +-- agent.service.ts      # ReAct loop
|   |       |   +-- tools.ts              # Tool definitions
|   |       |   +-- system-prompt.ts      # Agent instructions
|   |       +-- cache/
|   |       |   +-- cache.module.ts
|   |       |   +-- cache.service.ts      # node-cache wrapper
|   |       +-- chunker/
|   |       |   +-- chunker.module.ts
|   |       |   +-- chunker.service.ts    # HTML cleanup, token budgeting
|   |       +-- hn/
|   |       |   +-- hn.module.ts
|   |       |   +-- hn.service.ts         # Algolia + Firebase + caching
|   |       +-- llm/
|   |       |   +-- llm.module.ts
|   |       |   +-- llm.service.ts        # Facade (delegates to provider)
|   |       |   +-- llm-provider.interface.ts
|   |       |   +-- providers/
|   |       |       +-- claude.provider.ts
|   |       |       +-- mistral.provider.ts
|   |       |       +-- groq.provider.ts
|   |       +-- rag/
|   |       |   +-- rag.module.ts
|   |       |   +-- rag.controller.ts     # POST + SSE endpoints
|   |       +-- app/
|   |       |   +-- app.module.ts         # Root module
|   |       +-- main.ts
|   |
|   +-- web/                              # Angular frontend
|       +-- src/
|           +-- app/
|               +-- components/
|               |   +-- chat/
|               |   +-- agent-steps/
|               |   +-- source-card/
|               |   +-- provider-selector/ # Switch providers in UI
|               +-- services/
|               |   +-- rag.service.ts
|               +-- app.component.ts
|
+-- libs/
|   +-- shared-types/                     # Shared TypeScript interfaces
|       +-- src/
|           +-- index.ts
|
+-- evals/                                # Evaluation harness
|   +-- queries.json                      # Test queries + expected qualities
|   +-- run-eval.ts                       # Runner script
|   +-- score.ts                          # Scoring logic
|   +-- results/                          # Timestamped eval results
|
+-- nx.json
+-- tsconfig.base.json
+-- package.json
+-- .env
+-- .env.example
```

---

## 11. Key Design Decisions

### 11.1 Why ReAct over simple RAG?

Simple RAG: search once, stuff context, generate answer.
ReAct agent: search, evaluate, search again, dive into comments, THEN answer.

The agent produces dramatically better answers because it can:

- Reformulate queries based on initial results.
- Decide whether comments are worth fetching for a given story.
- Cross-reference multiple threads.
- Stop early when it has enough.

**Tradeoff:** More LLM calls (cost + latency). Mitigated by capping steps at 7 and streaming results.

### 11.2 Why SSE over WebSockets?

- SSE is simpler. Unidirectional (server to client) is all we need for streaming agent steps.
- Native browser support via `EventSource`. No library needed.
- NestJS has first-class `@Sse()` decorator support.
- Automatic reconnection built into the protocol.

WebSockets needed only if we add bidirectional follow-ups. That's a v2 feature.

Source: [MDN > EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource), [NestJS > SSE](https://docs.nestjs.com/techniques/server-sent-events)

### 11.3 Why Nx monorepo?

- **Shared types.** `@voxpopuli/shared-types` is the single source of truth. Change once, type-checked everywhere.
- **Unified tooling.** One `nx serve` per app. One `nx test`. One CI pipeline.
- **Dependency graph.** Nx rebuilds/retests only what's affected.

Source: [Nx docs > Why Nx](https://nx.dev/getting-started/why-nx)

### 11.4 Why triple-stack LLM instead of one?

See Section 5.1. Summary: Claude for quality, Mistral for cost, Groq for speed/dev. The provider interface adds ~200 lines of code. The savings justify it on day one.

### 11.5 Why not vector embeddings?

v1 uses Algolia keyword search. The agent compensates for keyword limitations by running multiple searches with different phrasings. Vector search adds infrastructure not justified until the agent loop is proven. v2 adds embeddings.

### 11.6 Why cache in v1?

Without caching, development burns through rate limits in an afternoon. Caching is infrastructure, not polish.

---

## 12. Evaluation Harness

**New in v1.1. Build this before the frontend.**

### 12.1 Why?

Success metrics (Section 15) are aspirational without tooling to measure them. The eval harness catches regressions when you change the system prompt, swap providers, or modify chunking.

### 12.2 Test Query Format

**File:** `evals/queries.json`

```json
[
  {
    "id": "q01",
    "query": "What does HN think about Rust vs Go for backend services?",
    "expectedQualities": [
      "mentions_both_languages",
      "cites_specific_stories",
      "includes_community_opinions",
      "presents_multiple_viewpoints"
    ],
    "expectedMinSources": 2,
    "maxAcceptableSteps": 5
  },
  {
    "id": "q02",
    "query": "Has anyone built a successful SaaS with just SQLite?",
    "expectedQualities": [
      "mentions_specific_projects",
      "discusses_limitations",
      "cites_specific_stories"
    ],
    "expectedMinSources": 1,
    "maxAcceptableSteps": 4
  }
]
```

### 12.3 Scoring

| Metric | How | Weight |
|--------|-----|--------|
| **Source accuracy** | Every `AgentSource.url` resolves (HTTP 200) | 30% |
| **Quality checklist** | LLM-as-judge checks each `expectedQuality` | 30% |
| **Efficiency** | Steps used vs `maxAcceptableSteps` | 15% |
| **Latency** | Total duration vs target | 15% |
| **Cost** | Total tokens vs $0.05 ceiling | 10% |

**LLM-as-judge:** A separate cheap model call (Haiku or equivalent) evaluates the answer against expected qualities.

### 12.4 Running Evals

```bash
# Single provider
npx tsx evals/run-eval.ts

# Specific provider
LLM_PROVIDER=groq npx tsx evals/run-eval.ts

# Compare all providers
npx tsx evals/run-eval.ts --compare claude,mistral,groq
```

Results saved to `evals/results/` with timestamps. Run after every agent-related change.

### 12.5 Initial Test Suite (20 queries)

| Category | Count | Examples |
|----------|-------|---------|
| Tool comparisons | 5 | "Rust vs Go", "React vs Svelte" |
| Opinion/sentiment | 4 | "What does HN think about remote work?" |
| Specific projects | 3 | "Has anyone used Turso in production?" |
| Recent events | 3 | "Latest AI agent frameworks" |
| Deep-dive requests | 3 | "Best arguments against microservices" |
| Edge cases | 2 | Gibberish input, non-HN questions |

---

## 13. Non-Functional Requirements

### 13.1 Performance

**Revised in v1.1: Honest latency targets.**

| Metric | Groq | Mistral | Claude |
|--------|------|---------|--------|
| Time to first SSE event | < 1s | < 1.5s | < 2s |
| 3-step query | < 8s | < 12s | < 15s |
| 5-step query | < 15s | < 20s | < 30s |
| Cached query | < 100ms | < 100ms | < 100ms |

**P50/P95 estimates (realistic):**

| Metric | Groq | Mistral | Claude |
|--------|------|---------|--------|
| P50 | ~6s | ~10s | ~13s |
| P95 | ~12s | ~20s | ~28s |

### 13.2 Reliability

| Concern | Mitigation |
|---------|-----------|
| HN API downtime | Retry with exponential backoff (3 attempts) |
| LLM API errors | Return partial results with error flag |
| LLM provider outage | Optional auto-fallback to next provider |
| Runaway agent loop | Hard cap at 7 steps + 60s global timeout |
| Token overflow | Per-provider budget in Chunker |
| Cost blowout | Rate limiting + max 5 concurrent agent runs |

### 13.3 Cost

| Provider | Est. Cost/Query | Monthly (100 queries/day) |
|----------|----------------|--------------------------|
| Claude | $0.02-0.08 | $60-240 |
| Mistral | $0.003-0.015 | $9-45 |
| Groq | $0.004-0.016 | $12-48 |
| Groq (free tier) | $0 | $0 (capped ~200-300 queries/day) |
| HN APIs | Free | Free |
| Infrastructure | $0 (dev) | $5-20 (Railway/Fly) |

### 13.4 Security

- API keys in `.env`, never committed. `.env.example` with placeholders.
- Rate limiting on all endpoints from day one.
- No auth in v1 (single-user local tool).
- Input sanitization + max query length (500 chars).
- All HN data is public. No PII concerns.

---

## 14. Roadmap

### v1.0 -- Foundation (Current Scope)

- [ ] Nx monorepo scaffold
- [ ] HN API service (Algolia + Firebase)
- [ ] In-memory caching layer (node-cache)
- [ ] Content chunker with per-provider token budgeting
- [ ] LLM provider interface + triple-stack (Claude, Mistral, Groq)
- [ ] Native tool_result protocol per provider
- [ ] ReAct agent loop (plan, act, observe, respond)
- [ ] RAG endpoints (POST + SSE) with rate limiting
- [ ] Evaluation harness (20 test queries)
- [ ] Angular chat UI with live agent step visualization
- [ ] Source cards with HN links
- [ ] Provider selector in UI
- [ ] Meta bar (provider, tokens, latency, cached)

### v1.1 -- Polish

- [ ] Loading skeleton UI
- [ ] Dark mode
- [ ] Mobile responsive layout
- [ ] Error boundary components
- [ ] Provider auto-fallback
- [ ] Query history (local storage)

### v2.0 -- Intelligence Upgrade

- [ ] Conversation memory (multi-turn)
- [ ] Semantic search (embeddings + Qdrant)
- [ ] Follow-up suggestions
- [ ] WebSocket upgrade
- [ ] Scheduled digests

### v3.0 -- Platform

- [ ] Multi-source RAG (Reddit, Stack Overflow, GitHub Discussions)
- [ ] User accounts + saved queries
- [ ] Bring-your-own API key
- [ ] Plugin system (Jira, Slack, Notion)
- [ ] Redis cache for multi-instance

---

## 15. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Answer relevance** | 80%+ "helpful" | Thumbs up/down in UI |
| **Source accuracy** | 0 hallucinated per 100 queries | Eval harness (automated) |
| **Quality pass rate** | 75%+ across eval queries | Eval harness (LLM-as-judge) |
| **Agent efficiency** | Avg 3.2 steps/query | Log analysis |
| **P50 latency (Groq)** | < 6s | Timing middleware |
| **P50 latency (Claude)** | < 13s | Timing middleware |
| **P95 latency (all)** | < 30s | Timing middleware |
| **Cost/query (Mistral)** | < $0.02 avg | Usage dashboard |
| **Cache hit rate** | > 15% after week 1 | CacheService stats |

---

## 16. Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9
- At least one LLM API key:
  - Groq (free): [console.groq.com](https://console.groq.com)
  - Mistral: [console.mistral.ai](https://console.mistral.ai)
  - Anthropic: [console.anthropic.com](https://console.anthropic.com)

### Setup

```bash
git clone https://github.com/your-username/voxpopuli.git
cd voxpopuli
npm install

cp .env.example .env
# Add at least one API key, set LLM_PROVIDER

npx nx serve api     # Terminal 1: backend on :3000
npx nx serve web     # Terminal 2: frontend on :4200

# Test
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What does HN think about the best programming fonts?"}'

# Run evals
npx tsx evals/run-eval.ts
```

---

## 17. Contributing

### Areas Where Help Is Needed

| Area | Difficulty | Impact |
|------|-----------|--------|
| Unit tests for ChunkerService | Easy | High |
| Retry logic in HnService | Easy | Medium |
| More eval test queries | Easy | High |
| Fourth LLM provider (OpenAI) | Medium | Medium |
| "Saved answers" feature | Medium | High |
| Semantic search with embeddings | Hard | Very High |
| Reddit as second data source | Medium | High |
| Provider auto-fallback logic | Medium | High |

### Code Style

- TypeScript strict mode. No `any`.
- JSDoc on all public methods.
- Stateless services.
- Source notations for external API behavior.
- All LLM providers must implement `LlmProviderInterface`.

---

## 18. License

MIT

---

> *"Three dealers at one table. The house doesn't stand a chance."*
> -- Doug "Double-Down" Donovan
