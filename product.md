# VoxPopuli — Product Specification

**Version:** 3.0.0
**Status:** Final Draft
**Last Updated:** April 8, 2026
**Author:** Abhishek Juneja

> _"Vox Populi, Vox Dei."_ -- The voice of the people is the voice of God.

---

## Revision Log

| Version | Date       | Changes                                                                                                                                                                                                                                             |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.0.0   | 2026-04-08 | Multi-agent pipeline architecture (Retriever/Synthesizer/Writer); new shared types (EvidenceBundle, AnalysisResult, AgentResponse v2); PipelineConfig with provider-per-agent mapping; SSE PipelineEvent protocol; feature flag for gradual rollout |
| 2.0.0   | 2026-04-03 | Version bump; final unified spec                                                                                                                                                                                                                    |
| 1.2.0   | 2026-03-31 | Merged voice addendum; 20 use cases; 3-layer trustworthiness framework; fact vs opinion taxonomy; single unified document                                                                                                                           |
| 1.1.0   | 2026-03-31 | Native tool_result protocol; caching + rate limiting promoted to v1.0; comment cap reduced to 30; eval harness added; latency targets revised; triple-stack LLM provider (Claude + Mistral + Groq)                                                  |
| 1.0.0   | 2026-03-31 | Initial draft                                                                                                                                                                                                                                       |

---

## 1. What is VoxPopuli?

VoxPopuli is an **agentic RAG (Retrieval-Augmented Generation) system** that turns Hacker News into a queryable knowledge base. Ask a question in natural language. The agent searches HN stories, crawls comment threads, reasons about what it finds, and delivers a sourced, synthesized answer -- with full transparency into its reasoning process.

It is not a chatbot wrapper. It is a **multi-agent research pipeline** where specialized agents handle retrieval, synthesis, and composition independently -- each optimized for its cognitive task, with different LLM providers assigned per stage.

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

| Persona                            | Use Case                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| **Engineers** choosing tools       | "What does HN think about Bun vs Deno in 2026?"               |
| **Founders** validating ideas      | "Has anyone built a competitor to X? What was the reception?" |
| **Researchers** tracking discourse | "How has sentiment on LLM agents changed over the past year?" |
| **Job seekers**                    | "What companies is HN excited about hiring at right now?"     |
| **Curious humans**                 | "What's the most controversial HN post about remote work?"    |

### Sample Use Cases (20)

**Engineers Making Decisions:**

1. "Bun vs Deno vs Node for a new backend in 2026" -- Agent searches 3-4 threads, pulls comment opinions from practitioners who actually migrated, synthesizes tradeoffs.
2. "Is Drizzle ORM production-ready?" -- Finds Show HN launch threads, digs into comments about edge cases, surfaces fans and critics.
3. "What database should I use for time-series IoT data?" -- Cross-references threads on TimescaleDB, InfluxDB, QuestDB with benchmarks from comments.
4. "What's the HN consensus on monorepos vs polyrepos at scale?" -- Extracts the strongest arguments from both sides of the recurring holy war.

**Founders and Product People:**

5. "Has anyone built a competitor to Notion? What was the reaction?" -- Surfaces Show HN launches and the brutal honesty HN is known for.
6. "What do developers actually hate about Stripe?" -- Categorizes gripes (pricing, docs, support), notes what Stripe responded to.
7. "Is there demand for an open-source alternative to Figma?" -- Searches Penpot and Figma acquisition threads, gauges sentiment.
8. "What startup ideas has HN consistently said 'someone should build this'?" -- Deep dive into Ask HN threads about missing tools and unmet needs.

**Researchers and Trend Watchers:**

9. "How has HN sentiment on AI agents changed over the past 12 months?" -- Date-sorted search, compares tone of early threads vs recent.
10. "What are the emerging programming languages HN is excited about?" -- Surfaces Zig, Gleam, Roc, Unison mentions, ranks by engagement.
11. "What do HN users think about the future of remote work post-2025?" -- Pulls from multiple heated threads, presents the full spectrum.
12. "Track the HN reaction to every major OpenAI announcement" -- Story-by-story breakdown of community trust over time.

**Job Seekers and Career:**

13. "What companies is HN most positive about working at right now?" -- Surfaces "Who is hiring" threads and comments praising specific teams.
14. "Is it worth learning Rust in 2026 for career purposes?" -- Hiring trends, career advice threads, and Rust adoption stories.
15. "What do senior engineers on HN say about moving into management?" -- Deep comment mining on a question that generates long, personal responses.

**Curiosity and Deep Dives:**

16. "What's the most controversial HN post of all time?" -- Searches by comment count + point ratio, finds the flamewars.
17. "Best books recommended on HN for system design" -- Mines Ask HN book threads, deduplicates, ranks by mention count.
18. "What side projects on Show HN actually turned into real businesses?" -- Cross-references Show HN history with later success stories.
19. "What do HN users think about college degrees in CS?" -- Synthesizes the self-taught vs degree camps.
20. "ELI5 the drama around the Node.js fork to io.js" -- Historical deep dive from original threads.

**The Podcast Angle:** Every use case becomes a listenable 2-3 minute segment with the voice layer. Daily routine: open VoxPopuli, type "What's interesting on HN today?", hit Listen, pour your coffee.

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

### 3.3 Multi-Agent Pipeline

**New in v3.0.** The single ReAct agent is replaced by a three-stage pipeline, each stage optimized for one cognitive task.

```
┌─────────────┐    EvidenceBundle    ┌──────────────┐    Analysis    ┌─────────────┐
│  RETRIEVER  │ ──────────────────▶  │  SYNTHESIZER │ ────────────▶ │   WRITER    │
│  (ReAct)    │                      │ (single-pass)│               │(single-pass)│
│             │                      │              │               │             │
│ Search HN   │                      │ Find patterns│               │ Craft prose │
│ Fetch data  │                      │ Spot conflict│               │ Add structure│
│ COMPACT     │                      │ Rate signal  │               │ Cite sources │
└─────────────┘                      └──────────────┘               └─────────────┘
       ▲                                                                   │
       │                        ┌──────────────┐                           │
       └─────────────────────── │ ORCHESTRATOR │ ◀─────────────────────────┘
                                └──────────────┘
```

**Why three agents:**

| Agent       | Needs tools?                             | Needs iteration?                   | Pattern                           |
| ----------- | ---------------------------------------- | ---------------------------------- | --------------------------------- |
| Retriever   | Yes (search_hn, get_story, get_comments) | Yes (may need follow-up searches)  | **ReAct loop**                    |
| Synthesizer | No (reasons over the bundle)             | No (one pass over structured data) | **Single-pass structured output** |
| Writer      | No (composes from analysis)              | No (one pass to compose prose)     | **Single-pass structured output** |

The Retriever collects raw HN data and **compacts** it into themed evidence groups (~600 tokens from 30+ comments). The Synthesizer extracts 3-5 insights ranked by evidence strength. The Writer turns structured analysis into readable prose with citations. No raw HN data crosses the Retriever boundary.

**Provider allocation:**

By default, all three agents use the **globally selected provider** (the `LLM_PROVIDER` env var or the UI provider selector). This keeps behavior consistent with the single-agent path and avoids requiring multiple API keys.

| Agent       | Default Provider        | `optimized` Preset Provider           | Why (optimized)                                                |
| ----------- | ----------------------- | ------------------------------------- | -------------------------------------------------------------- |
| Retriever   | Global (`LLM_PROVIDER`) | **Groq** (Llama 3.3 70B)              | Speed. Multiple tool calls need fast inference.                |
| Synthesizer | Global (`LLM_PROVIDER`) | **Claude** (claude-sonnet-4-20250514) | Reasoning depth. Pattern extraction needs the strongest model. |
| Writer      | Global (`LLM_PROVIDER`) | **Mistral** (mistral-large-latest)    | Cost-optimized. Structured prose from structured input.        |

Configurable per request via `PipelineConfig.providerMap`. When `providerMap` is omitted, it defaults to the global `LLM_PROVIDER` for all stages. Four preset profiles available: `default` (all global provider), `optimized` (Groq/Claude/Mistral split), `speed` (all Groq), `cost` (all Mistral).

**Feature flag:** `PipelineConfig.useMultiAgent` controls rollout. When `false`, falls back to the legacy single ReAct agent.

**Legacy compatibility:** The original ReAct agent (Section 3.3 in v2.0) remains available as a fallback. The Orchestrator's `runWithFallback()` method catches multi-agent pipeline errors and automatically degrades to the single-agent path.

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

| Data                      | TTL        | Reason                                         |
| ------------------------- | ---------- | ---------------------------------------------- |
| Algolia search results    | 15 minutes | Stories don't change fast, but new ones appear |
| Firebase items (stories)  | 1 hour     | Story metadata is stable                       |
| Firebase items (comments) | 30 minutes | Comments are semi-stable, but new ones arrive  |

**Layer 2: Query Result Cache**

| Data                             | TTL        | Reason                                                      |
| -------------------------------- | ---------- | ----------------------------------------------------------- |
| Full AgentResponse by query hash | 10 minutes | Identical queries within a short window get instant results |

Cache keys are deterministic hashes of the query + options. Cache is invalidated on TTL expiry only (no manual invalidation in v1).

Source: [node-cache docs](https://www.npmjs.com/package/node-cache)

### 3.7 Rate Limiting

**Promoted from v1.1 to v1.0 scope.**

The API is rate-limited from day one to prevent accidental cost blowouts and abuse.

| Scope                     | Limit              | Implementation                |
| ------------------------- | ------------------ | ----------------------------- |
| Per-IP query rate         | 10 requests/minute | express-rate-limit middleware |
| Global query rate         | 60 requests/minute | In-memory counter             |
| Max concurrent agent runs | 5                  | Semaphore in AgentService     |

Source: [express-rate-limit docs](https://www.npmjs.com/package/express-rate-limit)

### 3.8 Voice Output (Podcast Mode)

**New in v1.2.**

VoxPopuli can read its answers aloud using ElevenLabs TTS. The name means "voice of the people" -- it should literally have a voice.

**How it works:**

1. Agent finishes and returns a text answer.
2. User clicks the **Listen** button on the answer bubble.
3. Backend rewrites the answer into a **podcast-style script** (conversational tone, no markdown, no raw URLs, natural transitions).
4. Backend streams the script to ElevenLabs TTS API.
5. Frontend receives audio chunks and plays them through an `<audio>` element.

**Podcast Script Rewriting:**

Raw agent output is optimized for reading, not listening. Before TTS, a lightweight LLM call rewrites it:

```
INPUT (agent answer):
"Based on HN discussions, Tailwind v4 has been well-received.
[Story 39482731] by @dhh (423 points) praises the new..."

OUTPUT (podcast script):
"So here's what the Hacker News crowd thinks about Tailwind v4.
The reception has been largely positive. One highly upvoted post
by DHH, with over 400 points, praised the new oxide engine..."
```

Rules for the rewrite:

- Strip all markdown formatting, links, and brackets.
- Convert usernames to spoken form ("at DHH" becomes "DHH").
- Replace "Story 39482731" with natural references ("one popular thread").
- Add conversational transitions ("So here's the thing...", "Now interestingly...").
- Keep it concise. Target 60-90 seconds of audio (roughly 800-1200 characters).
- Preserve all factual claims and attributions.

**Signature Voice:**

VoxPopuli uses a single, fixed narrator voice. This gives the project a recognizable identity, like a podcast host. The voice ID is configured in `.env`:

```env
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM   # Rachel (stock, warm/professional)
ELEVENLABS_MODEL_ID=eleven_multilingual_v2   # Best for long-form narration
```

The voice should be: warm, clear, authoritative but not stiff, slightly conversational. Think "tech podcast host who respects your time."

**ElevenLabs Model Choice:**

| Model           | Use Case                              | Latency              | Credits/char |
| --------------- | ------------------------------------- | -------------------- | ------------ |
| Multilingual v2 | Default. Best quality for narration.  | ~300ms to first byte | 1.0          |
| Flash v2.5      | Fallback if latency is critical.      | ~75ms to first byte  | 0.5          |
| Eleven v3       | Stretch goal. Maximum expressiveness. | ~300ms               | ~1.0         |

**Cost per voiced answer:**

| Answer Length | Characters | Credits (Multilingual v2) | Cost (Starter $5/mo)         |
| ------------- | ---------- | ------------------------- | ---------------------------- |
| Short         | ~500       | 500                       | ~30k credits = 60 answers/mo |
| Medium        | ~1000      | 1,000                     | ~30 answers/mo               |
| Long          | ~1500      | 1,500                     | ~20 answers/mo               |

Source: [ElevenLabs TTS API](https://elevenlabs.io/docs/overview/capabilities/text-to-speech), [ElevenLabs Streaming](https://elevenlabs.io/docs/api-reference/streaming), [ElevenLabs Pricing](https://elevenlabs.io/pricing)

---

## 4. Architecture

### 4.1 High-Level Overview

```
+---------------------------------------------------------+
|                   Angular (web)                          |
|                                                          |
|  +---------+  +--------------+  +----------------+      |
|  | Chat UI |  | Agent Steps  |  | Source Cards    |     |
|  |         |  | (pipeline    |  |                 |     |
|  |  [Listen]  |  timeline)   |  | Trust Bar       |     |
|  |  Audio     |              |  |                 |     |
|  |  Player    |              |  |                 |     |
+--+----+-------+------+-------+--+-------+--------+-----+
        |              |                  |
        +--------------+------------------+
                       | SSE (PipelineEvent) / HTTP / Audio
+----------------------+--------------------------------------+
|                   NestJS (api)                               |
|                                                              |
|  +------------------------------------------------------+   |
|  |              RAG Controller                           |   |
|  |   POST /api/rag/query    (full response)              |   |
|  |   GET  /api/rag/stream   (SSE streaming)              |   |
|  |   POST /api/tts/speak    (audio stream)               |   |
|  +---------------------------+---------------------------+   |
|                              |                               |
|  +---------------------------+---------------------------+   |
|  |           Orchestrator Service                        |   |
|  |   PipelineConfig → Retriever → Synthesizer → Writer   |   |
|  |   SSE events at each stage transition                 |   |
|  |   Fallback to legacy ReAct on error                   |   |
|  +--------------------------------------------------------+  |
|        |                |                |                    |
|  +-----+------+  +------+-------+  +-----+------+           |
|  | Retriever  |  | Synthesizer  |  |   Writer   |           |
|  | (ReAct +   |  | (single-pass |  |(single-pass|           |
|  |  Compactor)|  |  analysis)   |  |  prose)    |           |
|  +-----+------+  +------+-------+  +-----+------+           |
|        |                |                |                    |
|     +--+---+        +---+---+        +---+---+               |
|     |HN API|        | LLM   |        | LLM   |              |
|     |+Cache|        |Service |        |Service |              |
|     +--+---+        +--+----+        +--+----+               |
|        |               |                |                     |
|     Algolia       Claude/Groq      Mistral/Groq              |
|     Firebase       (provider       (provider                  |
|                    per stage)       per stage)                 |
+------+------------------------------------------------------+
```

### 4.2 Tech Stack

| Layer                    | Technology                   | Why                                                    |
| ------------------------ | ---------------------------- | ------------------------------------------------------ |
| **Monorepo**             | Nx                           | Shared types, unified builds, dependency graph         |
| **Backend**              | NestJS (Node.js)             | Modular DI, first-class TypeScript, SSE support        |
| **Frontend**             | Angular 17+                  | Standalone components, signals, SSE via EventSource    |
| **LLM (production)**     | Claude (Anthropic API)       | Best synthesis quality, 200k context                   |
| **LLM (cost-optimized)** | Mistral Large 3              | 262k context, $0.50/$1.50 per M tokens                 |
| **LLM (speed/dev)**      | Groq (Llama 3.3 70B)         | 300+ t/s inference, free tier for dev                  |
| **Voice (TTS)**          | ElevenLabs (Multilingual v2) | Best voice quality, streaming, podcast-grade narration |
| **Caching**              | node-cache (in-memory)       | Zero-infrastructure, sufficient for single-node v1     |
| **Shared Types**         | TypeScript library           | Single source of truth for API contracts               |
| **Data Sources**         | HN Algolia + Firebase APIs   | Full-text search + structured item/comment data        |

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
|   +-- RetrieverAgent (ReAct loop + compaction)
|   +-- SynthesizerAgent (single-pass analysis)
|   +-- WriterAgent (single-pass prose)
|   +-- OrchestratorService (pipeline coordination)
+-- RagModule
|   +-- RagController
|       +-- POST /api/rag/query
|       +-- GET  /api/rag/stream (SSE)
|       +-- imports: AgentModule
+-- TtsModule
    +-- TtsService (ElevenLabs SDK + podcast rewrite via LlmService)
    +-- TtsController
        +-- POST /api/tts/narrate
        +-- GET  /api/tts/voices
        +-- imports: LlmModule
```

---

## 5. LLM Provider Architecture

### 5.1 Why Triple-Stack?

No single LLM wins on every axis. Different stages of the project need different things:

| Stage                      | Best Provider        | Why                                                    |
| -------------------------- | -------------------- | ------------------------------------------------------ |
| **Development**            | Groq (Llama 3.3 70B) | Free tier, 300+ t/s speed, instant feedback loops      |
| **Testing/CI**             | Groq or Mistral      | Cheap, fast, good enough for regression detection      |
| **Cost-optimized prod**    | Mistral Large 3      | Best quality-per-dollar, 262k context                  |
| **Quality-optimized prod** | Claude (Sonnet 4)    | Best multi-source synthesis, strongest agent reasoning |

### 5.2 Provider Comparison

| Factor                | Claude (Sonnet 4)        | Mistral Large 3             | Groq (Llama 3.3 70B)              |
| --------------------- | ------------------------ | --------------------------- | --------------------------------- |
| **Context window**    | 200k                     | 262k                        | 128k                              |
| **Output speed**      | ~50 t/s                  | ~80 t/s                     | 300+ t/s                          |
| **Input pricing**     | ~$3.00/M                 | $0.50/M                     | ~$0.59/M                          |
| **Output pricing**    | ~$15.00/M                | $1.50/M                     | ~$0.79/M                          |
| **Est. cost/query**   | $0.02-0.08               | $0.003-0.015                | $0.004-0.016                      |
| **Tool calling**      | Native (tool_use blocks) | Native (OpenAI-compatible)  | Native (OpenAI-compatible)        |
| **Free tier**         | No                       | Limited                     | Yes (1,000 req/day for Llama 3.3) |
| **Synthesis quality** | Excellent                | Strong                      | Good                              |
| **Agent reasoning**   | Excellent                | Strong                      | Adequate                          |
| **API format**        | Anthropic SDK            | Mistral SDK / OpenAI-compat | OpenAI-compatible                 |

### 5.3 Provider Interface (LangChain)

VoxPopuli uses **LangChain.js** as the LLM abstraction layer. Each provider is a thin wrapper around LangChain's `BaseChatModel`, which handles tool protocols, message formatting, and provider-specific serialization internally.

**Why LangChain.js over hand-rolled providers or Vercel AI SDK:**

| Option            | Pros                                                                                             | Cons                                                                                    | Decision                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **LangChain.js**  | Handles all tool protocols natively, battle-tested agent primitives, unified ChatModel interface | Extra dependency (~200KB), version coupling                                             | **Chosen.** Eliminates ~500 lines of hand-rolled tool protocol code. |
| **Hand-rolled**   | Zero dependencies, full control                                                                  | Must maintain 3 different tool_result protocols, message formats, and streaming parsers | Rejected. Too much plumbing for a solo dev.                          |
| **Vercel AI SDK** | Good streaming support                                                                           | Weaker agent/tool primitives, less mature tool calling                                  | Rejected. LangChain's agent support is more complete.                |

**Provider interface:**

```typescript
export interface LlmProviderInterface {
  /** Human-readable provider name (e.g., "groq", "claude", "mistral") */
  readonly name: string;

  /** Maximum context window tokens for this provider */
  readonly maxContextTokens: number;

  /**
   * Return the LangChain ChatModel instance for this provider.
   * The AgentService uses this to build the LangChain agent executor.
   * LangChain handles tool_result protocols, message formatting,
   * and streaming internally.
   */
  getModel(): BaseChatModel;
}
```

**What LangChain handles (we don't touch):**

- Native tool_use / tool_result content blocks (Claude)
- OpenAI-compatible tool role messages (Mistral, Groq)
- Message serialization per provider
- Streaming token delivery
- Tool call parsing from model responses

**What we own:**

- Provider instantiation and API key configuration
- Token budget management (ChunkerService)
- Caching layer (CacheService)
- SSE streaming to the frontend (RagController)
- Tool definitions (DynamicTool with Zod schemas)

**Provider implementations:**

| Provider    | LangChain Class | Package                | Config              |
| ----------- | --------------- | ---------------------- | ------------------- |
| **Claude**  | `ChatAnthropic` | `@langchain/anthropic` | `ANTHROPIC_API_KEY` |
| **Mistral** | `ChatMistralAI` | `@langchain/mistralai` | `MISTRAL_API_KEY`   |
| **Groq**    | `ChatGroq`      | `@langchain/groq`      | `GROQ_API_KEY`      |

Source: [LangChain.js ChatModels](https://js.langchain.com/docs/integrations/chat/), [LangChain.js Tool Calling](https://js.langchain.com/docs/how_to/tool_calling/)

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

### 6.1.1 Multi-Agent Pipeline Flow (v3.0)

When `useMultiAgent: true` (default in v3.0):

```
1. User types: "What does HN think about Tailwind v4?"
                    |
2. Angular sends:   GET /api/rag/stream?query=...  (SSE)
                    |
3. RagController → OrchestratorService.run(query, config)
                    |
4. Stage 1: RETRIEVER (ReAct loop, Groq by default)
   |  +-- search_hn("Tailwind v4") → 10 hits
   |  +-- get_comments(39482731) → 30 comments
   |  +-- search_hn("Tailwind CSS criticisms") → 8 hits
   |  +-- RETRIEVAL_COMPLETE
   |  +-- Compaction LLM call: 30+ raw items → 4 ThemeGroups (~600 tokens)
   |  → SSE: { stage: 'retriever', status: 'done', summary: '4 themes from 47 sources' }
                    |
5. Stage 2: SYNTHESIZER (single-pass, Claude by default)
   |  +-- Receives EvidenceBundle (4 themes, ~600 tokens)
   |  +-- Extracts 3 insights, 1 contradiction, confidence: high
   |  → SSE: { stage: 'synthesizer', status: 'done', summary: '3 insights, confidence: high' }
                    |
6. Stage 3: WRITER (single-pass, Mistral by default)
   |  +-- Receives AnalysisResult + source metadata
   |  +-- Composes headline, context, 3 sections, bottom line
   |  → SSE: { stage: 'writer', status: 'done', summary: '3 sections' }
                    |
7. PipelineResult returned with intermediates for eval harness
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

| Status | Condition                                        |
| ------ | ------------------------------------------------ |
| 400    | Empty or missing `query`                         |
| 429    | Rate limit exceeded                              |
| 500    | Agent execution failure (LLM error, API timeout) |

### 7.2 GET `/api/rag/stream`

Server-Sent Events endpoint. Streams reasoning steps in real time.

**Query Parameters:**

```
?query=...&maxSteps=5&includeComments=true&provider=groq
```

**Event Types:**

| Event         | Payload                      | When                    |
| ------------- | ---------------------------- | ----------------------- |
| `thought`     | `AgentStep`                  | Agent is reasoning      |
| `action`      | `AgentStep` (with tool call) | Agent is calling a tool |
| `observation` | `AgentStep` (with result)    | Tool returned data      |
| `answer`      | `AgentResponse`              | Final answer ready      |
| `error`       | `string`                     | Something broke         |

### 7.3 POST `/api/tts/speak`

**New in v1.2.** Converts an agent answer into podcast-style audio.

**Request:**

```typescript
{
  text: string;               // Required. The agent's answer text.
  rewrite?: boolean;          // Optional. Default: true. Rewrite to podcast script first.
  voiceId?: string;           // Optional. Override signature voice.
}
```

**Response:** Streaming audio (`Content-Type: audio/mpeg`). MP3 chunks sent via chunked transfer encoding. The client can begin playback before the full response is received.

**Headers:**

```
Content-Type: audio/mpeg
Transfer-Encoding: chunked
X-TTS-Characters: 1042          // Characters sent to ElevenLabs (for cost tracking)
X-TTS-Model: eleven_multilingual_v2
```

**Error Responses:**

| Status | Condition                                         |
| ------ | ------------------------------------------------- |
| 400    | Empty or missing `text`                           |
| 429    | Rate limit exceeded or ElevenLabs quota exhausted |
| 502    | ElevenLabs API error                              |

**Podcast Rewrite Flow:**

When `rewrite: true` (default), the text is first sent through a lightweight LLM call that reformats it for spoken delivery. The system prompt for this rewrite:

```
You are a podcast script writer. Rewrite the following text for spoken narration.

Rules:
- Remove all markdown, links, brackets, and formatting.
- Convert "@username" to just the name spoken naturally.
- Replace story IDs with natural references ("one popular thread", "a highly upvoted post").
- Add brief conversational transitions between points.
- Keep all factual claims and attributions intact.
- Target 800-1200 characters (60-90 seconds of speech).
- Sound like a knowledgeable tech podcast host: warm, clear, concise.
- Do NOT add intro/outro music cues or "[pause]" markers.
```

### 7.4 GET `/api/health`

Health check endpoint. Returns provider status and cache stats.

```typescript
{
  status: 'ok';
  provider: string;
  cacheStats: {
    hits: number;
    misses: number;
    keys: number;
  }
  uptime: number;
}
```

---

## 8. Agent Tool Specifications

The agent has access to three tools. The LLM decides which to call and in what order.

### 8.1 `search_hn`

| Parameter     | Type                      | Required | Description                |
| ------------- | ------------------------- | -------- | -------------------------- |
| `query`       | string                    | Yes      | Search keywords            |
| `sort_by`     | `"relevance"` \| `"date"` | No       | Default: relevance         |
| `min_points`  | number                    | No       | Filter low-quality stories |
| `max_results` | number                    | No       | 1-20, default 10           |

**Behavior:** Calls HN Algolia `/search` or `/search_by_date`. Results pass through CacheService (TTL: 15 min), then are chunked and token-counted before returning to the agent.

### 8.2 `get_story`

| Parameter  | Type   | Required | Description |
| ---------- | ------ | -------- | ----------- |
| `story_id` | number | Yes      | HN item ID  |

**Behavior:** Calls HN Firebase `/item/{id}.json`. Cached for 1 hour. Returns full item data.

### 8.3 `get_comments`

| Parameter   | Type   | Required | Description     |
| ----------- | ------ | -------- | --------------- |
| `story_id`  | number | Yes      | Parent story ID |
| `max_depth` | number | No       | 1-5, default 3  |

**Behavior:** Recursively fetches comment tree via Firebase. Individual items cached for 30 min. Strips HTML, assigns depth levels, **caps at 30 comments**. Fetches in parallel batches of 10.

---

## 9. Tool Use Protocol (via LangChain)

**This section documents the tool calling architecture. Updated in v2.0 to reflect LangChain.js integration.**

### 9.1 How Tool Calling Works

LangChain handles all provider-specific tool protocol differences internally. We define tools once using LangChain's `DynamicTool` with Zod schemas, and LangChain translates them to the correct format per provider:

```typescript
import { DynamicTool } from 'langchain/tools';
import { z } from 'zod';

const searchHnTool = new DynamicTool({
  name: 'search_hn',
  description: 'Search Hacker News stories via Algolia',
  schema: z.object({
    query: z.string().describe('Search keywords'),
    sort_by: z.enum(['relevance', 'date']).optional(),
    min_points: z.number().optional(),
    max_results: z.number().min(1).max(20).optional(),
  }),
  func: async (input) => {
    // Calls HnService.search(), chunks results, returns string
  },
});
```

### 9.2 What LangChain Handles Per Provider

| Provider    | Tool Format (handled by LangChain)        | Our Code                              |
| ----------- | ----------------------------------------- | ------------------------------------- |
| **Claude**  | `tool_use` / `tool_result` content blocks | Just provide `ChatAnthropic` instance |
| **Mistral** | OpenAI-compatible `tool` role messages    | Just provide `ChatMistralAI` instance |
| **Groq**    | OpenAI-compatible `tool` role messages    | Just provide `ChatGroq` instance      |

LangChain's `AgentExecutor` or `createToolCallingAgent` manages the ReAct loop internally, including:

- Parsing tool calls from model responses
- Executing tools and formatting results
- Building native tool_result messages per provider
- Managing the conversation history with tool results

### 9.3 Why This Matters

Using native protocols (via LangChain) gives the model clear separation between its own reasoning and external data. This produces:

- More accurate tool selection on steps 2+
- Fewer hallucinated tool arguments
- Better synthesis when multiple tool results are in context

### 9.4 What We Still Own

LangChain handles the protocol plumbing, but we control:

- **Tool implementations** (`func` callbacks that call HnService + ChunkerService)
- **Token budgeting** (ChunkerService fits content into provider-specific budgets)
- **Caching** (CacheService wraps all external API calls)
- **Step streaming** (we intercept agent callbacks to emit SSE events)
- **Safety constraints** (max 7 steps, 60s timeout, 5 concurrent runs)

Source: [LangChain.js Tool Calling](https://js.langchain.com/docs/how_to/tool_calling/), [LangChain.js Agents](https://js.langchain.com/docs/how_to/agent_executor/)

### 9.5 Pipeline Configuration (v3.0)

The multi-agent pipeline is configured via `PipelineConfig`:

```typescript
interface PipelineConfig {
  providerMap?: {
    // Optional — defaults to global LLM_PROVIDER for all stages
    retriever: LlmProvider;
    synthesizer: LlmProvider;
    writer: LlmProvider;
  };
  tokenBudgets: {
    retriever: number; // ~2000 output tokens
    synthesizer: number; // ~1500 output tokens
    writer: number; // ~1000 output tokens
  };
  timeoutMs: number;
  useMultiAgent: boolean; // Feature flag
}
```

**Default configuration:** All three agents use the globally selected provider (`LLM_PROVIDER`). Token budgets: retriever 2000, synthesizer 1500, writer 1000. Timeout: 30s.

Per-stage provider splitting (e.g., Groq for retrieval, Claude for synthesis) is available via `providerMap` but deferred as default until eval data justifies it.

**SSE event protocol:**

| Event           | Payload Fields                                         | When                  |
| --------------- | ------------------------------------------------------ | --------------------- |
| `PipelineEvent` | `stage`, `status`, `detail?`, `elapsedMs?`, `summary?` | Each stage transition |

Stage values: `retriever` | `synthesizer` | `writer`
Status values: `started` | `progress` | `done` | `error`

---

## 10. Project Structure

```
voxpopuli/
+-- apps/
|   +-- api/                              # NestJS backend
|   |   +-- src/
|   |       +-- agent/
|   |       |   +-- agent.module.ts
|   |       |   +-- agent.service.ts      # Legacy ReAct loop (fallback)
|   |       |   +-- retriever.agent.ts    # ReAct search + compaction
|   |       |   +-- synthesizer.agent.ts  # Single-pass analysis
|   |       |   +-- writer.agent.ts       # Single-pass prose composition
|   |       |   +-- orchestrator.service.ts # Pipeline coordination
|   |       |   +-- tools.ts              # Tool definitions
|   |       |   +-- system-prompt.ts      # Legacy agent instructions
|   |       |   +-- prompts/
|   |       |       +-- retriever.prompt.ts
|   |       |       +-- compactor.prompt.ts
|   |       |       +-- synthesizer.prompt.ts
|   |       |       +-- writer.prompt.ts
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
|   |       +-- tts/
|   |       |   +-- tts.module.ts
|   |       |   +-- tts.controller.ts     # Narrate + voices endpoints
|   |       |   +-- tts.service.ts        # ElevenLabs + podcast rewrite
|   |       |   +-- podcast-rewrite.prompt.ts
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
|               |   +-- audio-player/      # Listen button + playback controls
|               |   +-- provider-selector/ # Switch providers in UI
|               +-- services/
|               |   +-- rag.service.ts
|               |   +-- tts.service.ts     # POST to /api/tts/speak, play audio
|               +-- app.component.ts
|
+-- libs/
|   +-- shared-types/                     # Shared TypeScript interfaces
|       +-- src/
|           +-- index.ts
|           +-- evidence.types.ts         # EvidenceBundle, ThemeGroup, EvidenceItem
|           +-- analysis.types.ts         # AnalysisResult, Insight, Contradiction
|           +-- response.types.ts         # AgentResponse v2, ResponseSection
|           +-- pipeline.types.ts         # PipelineConfig, PipelineEvent, PipelineResult
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

### 11.7 Why Multi-Agent Pipeline over Single ReAct?

The single ReAct agent handles retrieval, analysis, and composition in one loop. This creates three problems:

1. **Context exhaustion.** The agent retrieves 30+ comments (~6,000 tokens of raw signal mixed with noise) then has to write the final answer with whatever reasoning budget is left.
2. **No explicit synthesis.** The agent jumps from "here's what I found" to "here's my answer" with no structured analysis in between.
3. **Single system prompt.** One instruction set handles search strategy, evidence evaluation, AND prose composition -- three distinct cognitive tasks.

The pipeline solves this by giving each agent exactly one job, one system prompt, and one output format. The Retriever compacts raw data, so the Synthesizer never sees noise. The Synthesizer structures analysis, so the Writer never has to reason about evidence strength.

**Cost impact:** Three LLM calls instead of one, but each call is smaller and more focused. With Groq (free tier) handling the Retriever and Mistral handling the Writer, only the Synthesizer uses the expensive Claude tier. Net cost is comparable to a single Claude ReAct run.

### 11.8 Why Compaction as a Separate Step?

The Retriever's ReAct loop collects raw HN data. A separate "compaction" LLM call after the loop converts 30+ raw comments into 3-6 themed evidence groups at ~600 tokens total. This is a separate call (not part of the ReAct loop) because:

- Collection and compaction are different cognitive tasks. Mixing them degrades both.
- Compaction has a fixed output shape (`EvidenceBundle`), making it reliable to parse.
- The compacted bundle is the **only** thing that crosses the Retriever boundary. No raw HN data reaches the Synthesizer.

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

| Metric                | How                                         | Weight |
| --------------------- | ------------------------------------------- | ------ |
| **Source accuracy**   | Every `AgentSource.url` resolves (HTTP 200) | 30%    |
| **Quality checklist** | LLM-as-judge checks each `expectedQuality`  | 30%    |
| **Efficiency**        | Steps used vs `maxAcceptableSteps`          | 15%    |
| **Latency**           | Total duration vs target                    | 15%    |
| **Cost**              | Total tokens vs $0.05 ceiling               | 10%    |

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

| Category           | Count | Examples                                |
| ------------------ | ----- | --------------------------------------- |
| Tool comparisons   | 5     | "Rust vs Go", "React vs Svelte"         |
| Opinion/sentiment  | 4     | "What does HN think about remote work?" |
| Specific projects  | 3     | "Has anyone used Turso in production?"  |
| Recent events      | 3     | "Latest AI agent frameworks"            |
| Deep-dive requests | 3     | "Best arguments against microservices"  |
| Edge cases         | 2     | Gibberish input, non-HN questions       |

---

## 13. Trustworthiness Framework

VoxPopuli has three trust layers. Each can fail independently. Each needs its own checks.

### 13.1 Layer 1: Agent Trustworthiness

The agent can hallucinate sources, fabricate consensus, cherry-pick stories, present outdated info as current, or generate confident nonsense when it found nothing.

**Automated checks (run in eval harness):**

| Check                | How                                                                | Target |
| -------------------- | ------------------------------------------------------------------ | ------ |
| Source existence     | Every `AgentSource.id` resolves via Firebase API (HTTP 200)        | 100%   |
| Attribution accuracy | Named usernames in answer appear in fetched comments (fuzzy match) | 95%+   |
| Consensus honesty    | LLM-as-judge: does answer present both sides on split topics?      | 80%+   |
| Source coverage      | `cited_sources / fetched_sources` ratio                            | > 20%  |
| Recency awareness    | Stories older than 2 years flagged in answer                       | 100%   |
| Honest "no results"  | Gibberish queries produce explicit "nothing found" disclaimer      | 100%   |

**Agent prompt rules that enforce trust:**

- "If all searches returned 0 relevant hits, say so. Do not fabricate an answer."
- "If the most relevant story is older than 2 years, explicitly note this."
- "High upvotes indicate popularity, not necessarily correctness. Note whether commenters provide evidence or just opinion."
- "If all top comments agree, search for a contrarian thread using terms like 'defense of X' or 'why X is actually good.'"

### 13.2 Layer 2: HN Crowd Trustworthiness

The crowd can be wrong. HN has known biases: Bay Area/startup culture, early adopter preferences, contrarian tendencies, language biases (Rust love, Java skepticism), and groupthink on certain topics.

**Mitigations built into the system:**

| Bias                                                       | Mitigation                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Survivorship bias** (confident prose > correct answers)  | Agent notes whether commenters provide evidence (benchmarks, links, experience) or just opinion                                          |
| **Demographic bias** (not representative of all engineers) | Standing disclaimer in UI: "VoxPopuli reflects HN community opinions, which skew toward startup culture and early adopter perspectives." |
| **Astroturfing / self-promotion**                          | Agent flags Show HN posts (author has vested interest). Source cards show `[Show HN]` tag.                                               |
| **Temporal decay**                                         | Agent prefers stories from last 12 months for current-state queries. Source cards show dates prominently.                                |
| **Groupthink**                                             | Agent prompt: actively search for contrarian threads on one-sided topics. Eval tests include known groupthink topics.                    |

**Automated checks:**

| Check                             | How                                                                                | Target               |
| --------------------------------- | ---------------------------------------------------------------------------------- | -------------------- |
| Recency of sources                | % of cited sources from last 12 months (for current-state queries)                 | > 60%                |
| Viewpoint diversity               | LLM-as-judge: does answer include at least one dissenting view on opinion queries? | 80%+                 |
| Show HN bias noted                | Answer mentions author's vested interest when citing Show HN posts                 | 100% (tag detection) |
| Evidence vs opinion distinguished | LLM-as-judge: does answer differentiate between backed claims and pure opinion?    | 70%+                 |

### 13.3 Layer 3: Podcast Rewrite Trustworthiness

The rewrite step is a game of telephone. Every transformation can lose or distort meaning.

**Five failure modes and their checks:**

| Failure                                                     | Check                       | How                                                              | Target                 |
| ----------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------- | ---------------------- |
| **Fact injection** (rewrite adds info not in original)      | Fact preservation test      | LLM-as-judge: "Does rewrite contain claims not in the original?" | 100% (zero new claims) |
| **Softening/hardening** ("divided" becomes "agreed")        | Sentiment preservation test | LLM-as-judge: compare confidence levels in original vs rewrite   | 95%+                   |
| **Attribution loss** (drops usernames)                      | Attribution retention       | Count named sources in original vs rewrite                       | > 80% retained         |
| **Nuance flattening** (5 arguments become 2)                | Argument coverage           | Count distinct claims in original vs rewrite                     | > 70% retained         |
| **Tone mismatch** (measured original, enthusiastic rewrite) | Tone alignment              | LLM-as-judge: rate tone match on 1-5 scale                       | > 4.0 average          |

**Prompt rules that enforce trust:**

- "Do NOT add information that wasn't in the original answer."
- "Preserve the original answer's level of certainty."
- "Keep all username attributions. Convert to spoken form but do not drop them."
- "Match the original answer's tone."

### 13.4 Trust Pipeline (Runtime)

```
Query arrives
     |
     v
Agent Loop
     +-- Source existence check (every ID resolves)
     +-- Attribution cross-reference (quotes match tool results)
     +-- Consensus honesty check (split topics flagged)
     |
     v
Answer produced
     +-- Recency tags on all sources
     +-- Viewpoint diversity score
     +-- Show HN bias flag
     +-- Trust metadata attached to AgentResponse
     |
     v
User clicks Listen (optional)
     |
     v
Podcast Rewrite
     +-- Fact preservation check
     +-- Sentiment preservation check
     +-- Attribution retention check
     |
     v
Audio delivered with trust indicators in UI
```

### 13.5 Trust Indicators in the UI

Users should assess trust at a glance:

```
+----------------------------------------------------+
| Agent Answer                                        |
|                                                     |
| "HN is broadly positive on Tailwind v4..."          |
|                                                     |
| [Trust Bar]                                         |
| Sources: 4 verified  |  Recency: 3/4 from 2026     |
| Viewpoints: balanced |  Show HN: 1 (flagged)        |
|                                                     |
| Sources: [card] [card] [card] [card]                |
|                                                     |
| [> Listen]  [Trust details v]                       |
+----------------------------------------------------+
```

Expandable trust details show: which sources were verified, their dates, whether contrarian views were found, Show HN flags, and for narrated answers, "Narration verified: no new claims added."

### 13.6 Trust-Specific Eval Queries

Add to `evals/queries.json`:

| ID  | Query                                     | What It Tests                                              |
| --- | ----------------------------------------- | ---------------------------------------------------------- |
| t01 | "Is Rust better than Go?"                 | Must present both sides. Fails if one-sided.               |
| t02 | "What does HN think of xyzzy florbnog?"   | Must say "no relevant discussions found."                  |
| t03 | "Is crypto dead?"                         | Must find at least one contrarian view (known groupthink). |
| t04 | Query targeting a Show HN post            | Must flag author's vested interest.                        |
| t05 | Query about a 2019-era tool as if current | Must note the age of sources.                              |
| t06 | Podcast rewrite of a balanced answer      | Rewrite must preserve balance.                             |
| t07 | Podcast rewrite of a heavily-cited answer | Must retain 80%+ named attributions.                       |

### 13.7 New Shared Types

```typescript
// Add to libs/shared-types/src/index.ts

export interface TrustMetadata {
  sourcesVerified: number; // Count of source IDs that resolved
  sourcesTotal: number; // Total sources cited
  avgSourceAge: number; // Average age in days
  recentSourceRatio: number; // % from last 12 months
  viewpointDiversity: 'one-sided' | 'balanced' | 'contested';
  showHnCount: number; // Number of Show HN sources (bias flag)
  honestyFlags: string[]; // e.g., ["no_results_found", "old_sources_noted"]
}

export interface RewriteTrustMetadata {
  factPreservation: boolean; // No new claims added
  attributionsRetained: number; // % of named sources kept
  toneAlignment: number; // 1-5 scale
}

// Updated AgentResponse
export interface AgentResponse {
  answer: string;
  steps: AgentStep[];
  sources: AgentSource[];
  trust: TrustMetadata; // NEW
  meta: {
    /* existing fields */
  };
}
```

### 13.9 Pipeline Types (v3.0)

```typescript
// Evidence types (Retriever output)
export interface EvidenceItem {
  sourceId: number;
  sourceType: 'story' | 'comment';
  content: string; // 1-3 sentences, NOT raw text
  classification: 'evidence' | 'anecdote' | 'opinion' | 'consensus';
  relevance: number; // 0.0 to 1.0
  timestamp: string;
  metadata: SourceMetadata;
}

export interface ThemeGroup {
  label: string; // "Performance concerns", "Migration stories"
  evidence: EvidenceItem[];
  sentiment: 'positive' | 'negative' | 'mixed' | 'neutral';
  rawSourceCount: number;
}

export interface EvidenceBundle {
  query: string;
  themes: ThemeGroup[];
  totalSourcesScanned: number;
  tokenCount: number;
  timeRange: { earliest: string; latest: string };
  allSources: SourceMetadata[];
}

// Analysis types (Synthesizer output)
export interface Insight {
  claim: string;
  supportingThemes: number[];
  strength: 'strong' | 'moderate' | 'weak';
  reasoning: string;
}

export interface Contradiction {
  positionA: string;
  positionB: string;
  relevantThemes: number[];
  assessment: string;
}

export interface AnalysisResult {
  insights: Insight[]; // 3-5, strongest first. NEVER more than 5.
  contradictions: Contradiction[];
  confidence: 'high' | 'medium' | 'low';
  gaps: string[];
  summary: string;
}

// Response types (Writer output)
export interface ResponseSection {
  heading: string;
  body: string;
  citedSources: number[];
}

export interface AgentResponse {
  headline: string;
  context: string;
  sections: ResponseSection[];
  bottomLine: string;
  confidence: 'high' | 'medium' | 'low';
  gaps: string[];
  sources: SourceMetadata[];
}

// Pipeline types (Orchestrator)
export interface PipelineConfig {
  /** Optional — when omitted, all stages use the global LLM_PROVIDER. */
  providerMap?: { retriever: LlmProvider; synthesizer: LlmProvider; writer: LlmProvider };
  tokenBudgets: { retriever: number; synthesizer: number; writer: number };
  timeoutMs: number;
  useMultiAgent: boolean;
}

// Default config: all stages use global LLM_PROVIDER. Additional presets
// (optimized, speed, cost) deferred until eval data justifies per-stage splitting.

export type PipelineStage = 'retriever' | 'synthesizer' | 'writer';
export type StageStatus = 'started' | 'progress' | 'done' | 'error';

export interface PipelineEvent {
  stage: PipelineStage;
  status: StageStatus;
  detail?: string;
  elapsedMs?: number;
  summary?: string;
}

export interface PipelineResult {
  response: AgentResponse;
  intermediates: { evidenceBundle: EvidenceBundle; analysisResult: AnalysisResult };
  timing: Record<PipelineStage, number>;
  tokenUsage: Record<PipelineStage, { input: number; output: number }>;
  providersUsed: Record<PipelineStage, LlmProvider>;
}
```

### 13.8 Fact vs Opinion Distinction

HN comments mix testable claims, personal experience, and subjective takes in the same sentence. VoxPopuli must surface this distinction at every layer.

**Claim taxonomy:**

| Type          | Definition                                      | Agent Phrasing                              | UI Badge    | Podcast Cue                                    |
| ------------- | ----------------------------------------------- | ------------------------------------------- | ----------- | ---------------------------------------------- |
| **Evidence**  | Backed by data, benchmarks, links               | "User X reported [specific detail]..."      | Blue badge  | "And there's data to back this up..."          |
| **Consensus** | Multiple commenters independently agree         | "Several commenters independently noted..." | Green badge | "This is where the thread converged..."        |
| **Anecdote**  | Personal experience, not independently testable | "In their experience..."                    | Amber badge | "Now, this is one person's experience, but..." |
| **Opinion**   | Subjective preference or prediction             | "Some commenters argued..."                 | Gray badge  | "Not everyone agrees..."                       |

**Credibility signals the agent should weight:**

| Signal                                     | Detection              | Effect                           |
| ------------------------------------------ | ---------------------- | -------------------------------- |
| Specific data (numbers, benchmarks)        | Text analysis          | Elevates to evidence             |
| Self-identified expertise ("I maintain X") | Text pattern           | Notes credentials in attribution |
| High upvotes (50+)                         | Comment metadata       | Community-validated              |
| Links to external sources                  | URL detection          | External evidence                |
| Contradicted by upvoted replies            | Child comment analysis | Weakens parent claim             |

**Implementation:**

- **v1.0 (free, prompt-only):** Agent system prompt classifies claims using the phrasing above. Podcast rewrite prompt uses verbal cues. Zero extra cost.
- **v1.1 (structured):** Second LLM pass extracts `Claim[]` metadata from the answer. UI renders color-coded badges. ~$0.002/query on Groq.

**New type:**

```typescript
export interface Claim {
  text: string;
  type: 'evidence' | 'anecdote' | 'opinion' | 'consensus';
  attribution: string;
  confidence: number; // 0-1
  supportingData?: string; // benchmark, link, or specific detail
}
```

---

## 14. Non-Functional Requirements

### 14.1 Performance

**Revised in v1.1: Honest latency targets.**

| Metric                  | Groq    | Mistral | Claude  |
| ----------------------- | ------- | ------- | ------- |
| Time to first SSE event | < 1s    | < 1.5s  | < 2s    |
| 3-step query            | < 8s    | < 12s   | < 15s   |
| 5-step query            | < 15s   | < 20s   | < 30s   |
| Cached query            | < 100ms | < 100ms | < 100ms |

**P50/P95 estimates (realistic):**

| Metric | Groq | Mistral | Claude |
| ------ | ---- | ------- | ------ |
| P50    | ~6s  | ~10s    | ~13s   |
| P95    | ~12s | ~20s    | ~28s   |

### 14.2 Reliability

| Concern             | Mitigation                                  |
| ------------------- | ------------------------------------------- |
| HN API downtime     | Retry with exponential backoff (3 attempts) |
| LLM API errors      | Return partial results with error flag      |
| LLM provider outage | Optional auto-fallback to next provider     |
| Runaway agent loop  | Hard cap at 7 steps + 60s global timeout    |
| Token overflow      | Per-provider budget in Chunker              |
| Cost blowout        | Rate limiting + max 5 concurrent agent runs |

### 14.3 Cost

| Provider         | Est. Cost/Query | Monthly (100 queries/day)        |
| ---------------- | --------------- | -------------------------------- |
| Claude           | $0.02-0.08      | $60-240                          |
| Mistral          | $0.003-0.015    | $9-45                            |
| Groq             | $0.004-0.016    | $12-48                           |
| Groq (free tier) | $0              | $0 (capped ~200-300 queries/day) |
| HN APIs          | Free            | Free                             |
| Infrastructure   | $0 (dev)        | $5-20 (Railway/Fly)              |

### 14.4 Security

- API keys in `.env`, never committed. `.env.example` with placeholders.
- Rate limiting on all endpoints from day one.
- No auth in v1 (single-user local tool).
- Input sanitization + max query length (500 chars).
- All HN data is public. No PII concerns.

---

## 15. Roadmap

### v1.0 -- Foundation (Current Scope)

- [ ] Nx monorepo scaffold
- [ ] HN API service (Algolia + Firebase)
- [ ] In-memory caching layer (node-cache)
- [ ] Content chunker with per-provider token budgeting
- [ ] LLM provider interface + triple-stack (Claude, Mistral, Groq)
- [ ] Native tool_result protocol per provider (via LangChain)
- [ ] ReAct agent loop (plan, act, observe, respond)
- [ ] RAG endpoints (POST + SSE) with rate limiting
- [ ] Evaluation harness (20 test queries)
- [ ] Angular chat UI with live agent step visualization
- [ ] Source cards with HN links
- [ ] Provider selector in UI
- [ ] Meta bar (provider, tokens, latency, cached)
- [ ] TtsModule (ElevenLabs streaming TTS)
- [ ] Podcast rewrite prompt + LLM call
- [ ] Audio player component with Listen button
- [ ] Playback speed controls + MP3 download
- [ ] Trust metadata on AgentResponse (source verification, recency, diversity)
- [ ] Trust bar UI component
- [ ] Trust-specific eval queries (7 queries)
- [ ] ElevenLabs TTS integration (TtsService + streaming endpoint)
- [ ] Podcast script rewriter (LLM-powered text-to-speech preprocessing)
- [ ] Listen button + audio player component
- [ ] Signature narrator voice configuration

### v1.1 -- Polish

- [ ] Loading skeleton UI
- [ ] Dark mode
- [ ] Mobile responsive layout
- [ ] Error boundary components
- [ ] Provider auto-fallback
- [ ] Query history (local storage)
- [ ] Waveform visualization on audio player
- [ ] Audio caching (same narration if answer unchanged)
- [ ] Voice selector (2-3 preset voices)
- [ ] "Podcast mode" toggle (auto-narrate every answer)
- [ ] Voice: playback speed controls (0.75x, 1x, 1.25x, 1.5x)
- [ ] Voice: downloadable MP3 of narrated answer

### v2.0 -- Multi-Agent Pipeline (Current Scope)

- [ ] Shared types: EvidenceBundle, AnalysisResult, AgentResponse v2, PipelineConfig
- [ ] RetrieverAgent: ReAct loop + compaction
- [ ] SynthesizerAgent: single-pass analysis
- [ ] WriterAgent: single-pass prose composition
- [ ] OrchestratorService: pipeline coordination + SSE events
- [ ] PipelineConfig presets: default (global provider), optimized, speed, cost
- [ ] Feature flag: `useMultiAgent` (OFF by default initially)
- [ ] Fallback to legacy ReAct on pipeline error
- [ ] Angular: PipelineEvent SSE integration in agent steps timeline
- [ ] Integration tests: 60+ new tests
- [ ] Eval harness: multi-agent vs single-agent comparison

### v2.1 -- Intelligence Upgrade

- [ ] Conversation memory (multi-turn)
- [ ] Semantic search (embeddings + Qdrant)
- [ ] Follow-up suggestions
- [ ] WebSocket upgrade
- [ ] Scheduled digests
- [ ] Downloadable podcast episodes (batch answers into one MP3)
- [ ] RSS podcast feed (subscribe in podcast apps)
- [ ] Voice input (STT via Groq Whisper)
- [ ] Two-voice dialogue mode (host + guest debating HN opinions)
- [ ] Voice: auto-play podcast mode (toggle in settings)
- [ ] Voice: user-selectable voice library
- [ ] Voice: RSS podcast feed (subscribe in podcast apps)

### v3.0 -- Platform

- [ ] Multi-source RAG (Reddit, Stack Overflow, GitHub Discussions)
- [ ] User accounts + saved queries
- [ ] Bring-your-own API key
- [ ] Plugin system (Jira, Slack, Notion)
- [ ] Redis cache for multi-instance

---

## 16. Success Metrics

| Metric                   | Target                         | How to Measure              |
| ------------------------ | ------------------------------ | --------------------------- |
| **Answer relevance**     | 80%+ "helpful"                 | Thumbs up/down in UI        |
| **Source accuracy**      | 0 hallucinated per 100 queries | Eval harness (automated)    |
| **Quality pass rate**    | 75%+ across eval queries       | Eval harness (LLM-as-judge) |
| **Agent efficiency**     | Avg 3.2 steps/query            | Log analysis                |
| **P50 latency (Groq)**   | < 6s                           | Timing middleware           |
| **P50 latency (Claude)** | < 13s                          | Timing middleware           |
| **P95 latency (all)**    | < 30s                          | Timing middleware           |
| **Cost/query (Mistral)** | < $0.02 avg                    | Usage dashboard             |
| **Cache hit rate**       | > 15% after week 1             | CacheService stats          |

---

## 17. Getting Started

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

## 18. Contributing

### Areas Where Help Is Needed

| Area                            | Difficulty | Impact    |
| ------------------------------- | ---------- | --------- |
| Unit tests for ChunkerService   | Easy       | High      |
| Retry logic in HnService        | Easy       | Medium    |
| More eval test queries          | Easy       | High      |
| Fourth LLM provider (OpenAI)    | Medium     | Medium    |
| "Saved answers" feature         | Medium     | High      |
| Semantic search with embeddings | Hard       | Very High |
| Reddit as second data source    | Medium     | High      |
| Provider auto-fallback logic    | Medium     | High      |

### Code Style

- TypeScript strict mode. No `any`.
- JSDoc on all public methods.
- Stateless services.
- Source notations for external API behavior.
- All LLM providers must implement `LlmProviderInterface`.

---

## 19. Voice Output (ElevenLabs TTS)

### 19.1 Overview

When the agent finishes an answer, users can press a Listen button to hear it narrated in a podcast-style voice. The answer is rewritten into conversational speech, sent to ElevenLabs TTS, and streamed back as audio.

### 19.2 Pipeline

```
1. Agent produces answer (markdown text with citations)
2. User clicks "Listen"
3. POST /api/tts/narrate { text, sources }
4. TtsService:
   a) Podcast Rewrite (LLM call):
      - Strip markdown, links, code blocks
      - Convert citations to spoken references
      - Add opening hook + sign-off ("That's the signal from HN. I'm VoxPopuli.")
      - Cap at 2500 characters
   b) ElevenLabs Streaming TTS:
      - POST /v1/text-to-speech/{voice_id}/stream
      - Returns chunked MP3 audio
5. Frontend: HTML5 <audio> plays as chunks arrive
```

### 19.3 Signature Voice

**Primary: "Brian"** (voice ID: `nPczCjzI2devNBz1zQrb`)

- Calm, steady, news-reader pacing
- Stock voice, available on all ElevenLabs tiers (including free)

**Backup: "Mattie"** (warm, conversational podcast style)

**Voice settings:**

```typescript
{
  model_id: "eleven_multilingual_v2",
  voice_settings: {
    stability: 0.65,
    similarity_boost: 0.75,
    style: 0.35,
    use_speaker_boost: true
  }
}
```

Source: [ElevenLabs > TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [ElevenLabs > Streaming](https://elevenlabs.io/docs/api-reference/streaming)

### 19.4 API Endpoints

**POST `/api/tts/narrate`**

Request:

```typescript
{ text: string; sources?: AgentSource[]; format?: string; }
```

Response: `Content-Type: audio/mpeg` (chunked MP3 stream)

Errors: 400 (empty/too long text), 429 (credit exhaustion), 502 (ElevenLabs failure)

**GET `/api/tts/voices`** -- Returns active narrator info.

### 19.5 Podcast Rewrite Example

**Raw agent answer:**

```
Based on HN discussions, **Tailwind v4** has been broadly well-received.
A [highly upvoted story](https://...) by user `swyx` (340 points) praised
the new Oxide engine. However, `tptacek` argued that utility-first CSS
creates maintenance debt at scale (127 upvotes).
```

**After podcast rewrite:**

```
So, here's what the Hacker News crowd has to say about Tailwind v4.
The reception has been broadly positive. A highly upvoted post by swyx,
with over 340 points, praised the new Oxide engine for some serious
speed improvements. But not everyone's on board. A commenter named
tptacek argued that utility-first CSS creates maintenance debt at scale.
That's the signal from Hacker News. I'm VoxPopuli.
```

### 19.6 Frontend: Audio Player

States: IDLE (Listen button) -> LOADING -> STREAMING (playing) -> PAUSED -> COMPLETE (listen again + download)

Controls: play/pause, progress bar, speed (0.75x / 1x / 1.25x / 1.5x), download MP3.

### 19.7 New Module

```
TtsModule
+-- TtsService
|   +-- narrate(text, sources) -> ReadableStream<Buffer>
|   +-- rewriteForSpeech(text, sources) -> string (LLM call)
|   +-- streamAudio(script) -> ReadableStream<Buffer> (ElevenLabs)
+-- TtsController
    +-- POST /api/tts/narrate
    +-- GET  /api/tts/voices
```

### 19.8 New Dependencies and Config

```bash
npm install elevenlabs
```

```env
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=nPczCjzI2devNBz1zQrb
ELEVENLABS_MODEL=eleven_multilingual_v2
```

### 19.9 Cost Impact

Per narration: ~$0.001 (LLM rewrite) + 1500-2500 ElevenLabs credits.

| Usage (assuming 30% of queries use Listen) | Plan Needed      | Monthly Cost |
| ------------------------------------------ | ---------------- | ------------ |
| 20 queries/day, 6 narrations/day           | Starter ($5/mo)  | $5/mo        |
| 50 queries/day, 15 narrations/day          | Creator ($22/mo) | $22/mo       |
| 100 queries/day, 30 narrations/day         | Pro ($99/mo)     | $99/mo       |

### 19.10 Risks

| Risk                         | Mitigation                                              |
| ---------------------------- | ------------------------------------------------------- |
| ElevenLabs cold start (2-4s) | Show "Preparing narration..." loading state             |
| Credit exhaustion            | Disable Listen button, show "Voice credits used up"     |
| Rewrite hallucination        | Eval check: compare rewrite against original answer     |
| Long answers (>3000 chars)   | Chunk with `previous_request_id` for prosody continuity |
| Voice removed from library   | Fallback voice in config (Mattie)                       |

---

## 20. License

MIT

---
