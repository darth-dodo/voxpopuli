# VoxPopuli — Architecture & Implementation Plan

**Companion to:** [product.md](product.md) (what & why)
**This document:** how to build it, in what order, and how to track it in Linear

---

## Document Map

| Document | Purpose |
|----------|---------|
| [product.md](product.md) | Product vision, capabilities, API contracts, design decisions |
| **architecture.md** (this) | Technical architecture, module design, milestones, Linear task breakdown |
| [README.md](README.md) | Public-facing overview for users and contributors |

---

## 1. System Architecture

### 1.1 High-Level Diagram

```mermaid
graph TB
    subgraph Frontend ["Angular 17+ (apps/web)"]
        CHAT["Chat Component"]
        STEPS["Agent Steps Component"]
        SOURCES["Source Cards Component"]
        AUDIO["Audio Player Component"]
        PROVIDER["Provider Selector"]
    end

    subgraph Backend ["NestJS (apps/api)"]
        RAG["RagController<br/>POST /query | GET /stream"]
        TTS_C["TtsController<br/>POST /narrate | GET /voices"]
        AGENT["AgentService<br/>ReAct Loop"]
        HN["HnService<br/>Algolia + Firebase"]
        CHUNKER["ChunkerService<br/>Token Budgeting"]
        LLM["LlmService<br/>Provider Facade"]
        TTS_S["TtsService<br/>Podcast Rewrite + Stream"]
        CACHE["CacheService<br/>node-cache"]
    end

    subgraph Providers ["LLM Providers"]
        CLAUDE["Claude Sonnet 4"]
        MISTRAL["Mistral Large 3"]
        GROQ["Groq Llama 3.3 70B"]
    end

    subgraph External ["External APIs"]
        ALGOLIA["HN Algolia"]
        FIREBASE["HN Firebase"]
        ELEVEN["ElevenLabs TTS"]
    end

    CHAT <-->|SSE / HTTP| RAG
    AUDIO -->|HTTP| TTS_C
    RAG --> AGENT
    TTS_C --> TTS_S
    AGENT --> HN
    AGENT --> CHUNKER
    AGENT --> LLM
    TTS_S --> LLM
    TTS_S --> ELEVEN
    HN --> CACHE
    HN --> ALGOLIA
    HN --> FIREBASE
    LLM --> CLAUDE
    LLM --> MISTRAL
    LLM --> GROQ

    style Frontend fill:#dbeafe,stroke:#1e40af,color:#1e40af
    style Backend fill:#f8f9fa,stroke:#343a40,color:#343a40
    style Providers fill:#fef3c7,stroke:#92400e,color:#92400e
    style External fill:#ede9fe,stroke:#5b21b6,color:#5b21b6
```

### 1.2 Module Dependency Graph

```mermaid
graph TD
    APP["AppModule"] --> CONFIG["ConfigModule<br/>(global)"]
    APP --> CACHE_M["CacheModule"]
    APP --> HN_M["HnModule"]
    APP --> CHUNK_M["ChunkerModule"]
    APP --> LLM_M["LlmModule"]
    APP --> TTS_M["TtsModule"]
    APP --> AGENT_M["AgentModule"]
    APP --> RAG_M["RagModule"]

    HN_M -->|injects| CACHE_M
    AGENT_M -->|imports| HN_M
    AGENT_M -->|imports| CHUNK_M
    AGENT_M -->|imports| LLM_M
    TTS_M -->|imports| LLM_M
    RAG_M -->|imports| AGENT_M

    style APP fill:#f8f9fa,stroke:#343a40
    style AGENT_M fill:#dbeafe,stroke:#1e40af
    style LLM_M fill:#fef3c7,stroke:#92400e
    style RAG_M fill:#d1fae5,stroke:#065f46
```

### 1.3 Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Monorepo | Nx | Latest |
| Backend | NestJS | 10+ |
| Frontend | Angular | 17+ |
| LLM (quality) | Claude Sonnet 4 | Anthropic SDK |
| LLM (cost) | Mistral Large 3 | Mistral SDK |
| LLM (speed/dev) | Groq Llama 3.3 70B | OpenAI-compat |
| TTS | ElevenLabs | elevenlabs SDK |
| Cache | node-cache | Latest |
| Shared Types | TypeScript lib | `@voxpopuli/shared-types` |

### 1.4 Project Structure

```
voxpopuli/
+-- apps/
|   +-- api/src/
|   |   +-- app/           # AppModule, main.ts
|   |   +-- agent/         # AgentService, tools, system prompt
|   |   +-- cache/         # CacheService (node-cache wrapper)
|   |   +-- chunker/       # ChunkerService (HTML cleanup, token budgeting)
|   |   +-- hn/            # HnService (Algolia + Firebase + caching)
|   |   +-- llm/           # LlmService, LlmProviderInterface, providers/
|   |   +-- rag/           # RagController (POST + SSE)
|   |   +-- tts/           # TtsService, TtsController, podcast-rewrite prompt
|   +-- web/src/app/
|       +-- components/    # chat, agent-steps, source-card, audio-player, provider-selector
|       +-- services/      # rag.service.ts, tts.service.ts
+-- libs/
|   +-- shared-types/src/  # All shared interfaces (AgentResponse, AgentStep, etc.)
+-- evals/                 # queries.json, run-eval.ts, score.ts, results/
```

---

## 2. Module Specifications

### 2.1 Shared Types (`libs/shared-types`)

Single source of truth for all API contracts. Both apps import from `@voxpopuli/shared-types`.

**Key interfaces:**

| Interface | Purpose |
|-----------|---------|
| `RagQuery` | Query request shape |
| `AgentResponse` | Full response: answer + steps + sources + meta |
| `AgentStep` | Single reasoning step (thought/action/observation) |
| `AgentSource` | Story metadata with HN link |
| `StoryChunk` | Chunked story for context window |
| `CommentChunk` | Chunked comment for context window |
| `ToolDefinition` | Agent tool schema (search_hn, get_story, get_comments) |
| `LlmMessage` | Provider-agnostic message format |
| `LlmResponse` | Provider-agnostic response format |
| `TtsRequest` | TTS narration request shape |

### 2.2 CacheModule

Wraps `node-cache` with typed get/set and TTL management.

| Method | TTL | Description |
|--------|-----|-------------|
| `getOrSet<T>(key, fetcher, ttl)` | varies | Cache-aside pattern |
| Search results | 15 min | Algolia responses |
| Stories | 1 hour | Firebase item data |
| Comments | 30 min | Firebase comment data |
| Query results | 10 min | Full AgentResponse by query hash |

### 2.3 HnModule

Two HTTP clients behind one service, all calls wrapped with CacheService.

| Client | Base URL | Methods |
|--------|----------|---------|
| Algolia | `hn.algolia.com/api/v1` | `search()`, `searchByDate()` |
| Firebase | `hacker-news.firebaseio.com/v0` | `getItem()`, `getCommentTree()` |

**Comment tree fetching:** Parallel batches of 10, hard cap 30 comments, skip deleted/dead. See product.md Section 6.3.

### 2.4 ChunkerModule

Transforms raw HN data into token-budgeted context for the LLM.

| Method | Input | Output |
|--------|-------|--------|
| `chunkStories(hits[])` | Algolia search hits | `StoryChunk[]` |
| `chunkComments(items[])` | Firebase comment tree | `CommentChunk[]` |
| `buildContext(chunks[], budget)` | Mixed chunks | `ContextWindow` (fits budget) |
| `formatForPrompt(context)` | ContextWindow | String (ready for LLM) |

**Token budgets:** Claude 80k, Mistral 100k, Groq 50k. Priority: metadata > story text > top-level comments > nested comments.

### 2.5 LlmModule

Provider interface + facade pattern. See product.md Section 5 for full interface definition and native tool protocol details.

| Component | Responsibility |
|-----------|---------------|
| `LlmProviderInterface` | Abstract contract (chat, formatTools, buildToolResultMessage) |
| `ClaudeProvider` | Anthropic SDK, tool_use/tool_result content blocks |
| `MistralProvider` | Mistral SDK, OpenAI-compatible tool calls |
| `GroqProvider` | OpenAI-compatible SDK, tool role messages |
| `LlmService` | Facade: reads `LLM_PROVIDER` env, delegates to active provider |

### 2.6 AgentModule

The ReAct loop. See product.md Section 3.3 for the pattern and Section 8 for tool specs.

| Method | Description |
|--------|-------------|
| `run(query, options)` | Execute full ReAct loop, return AgentResponse |
| `executeTool(name, params)` | Dispatch to HnService, return chunked results |

**Constraints:** Max 7 steps, 60s global timeout, 5 concurrent runs (semaphore).

**Tools:** `search_hn`, `get_story`, `get_comments`. Defined in `tools.ts`, system prompt in `system-prompt.ts`.

### 2.7 RagModule

Thin controller layer. No business logic.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rag/query` | POST | Full blocking response |
| `/api/rag/stream` | GET | SSE streaming of reasoning steps |
| `/api/health` | GET | Provider status + cache stats |

**Middleware:** Rate limiting (10/min per IP, 60/min global) via `express-rate-limit`.

### 2.8 TtsModule

See product.md Section 18 for full pipeline, voice config, and cost analysis.

| Method | Description |
|--------|-------------|
| `TtsService.narrate(text, sources)` | Full pipeline: rewrite + stream audio |
| `TtsService.rewriteForSpeech(text)` | LLM call to convert markdown to podcast script |
| `TtsService.streamAudio(script)` | ElevenLabs streaming TTS |

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tts/narrate` | POST | Streaming MP3 audio response |
| `/api/tts/voices` | GET | Active narrator info |

### 2.9 Frontend Components

| Component | Responsibility |
|-----------|---------------|
| `ChatComponent` | Query input, answer display, conversation layout |
| `AgentStepsComponent` | Real-time step timeline (expandable) |
| `SourceCardComponent` | Story card with title, author, points, HN link |
| `AudioPlayerComponent` | Listen button, play/pause, progress, speed, download |
| `ProviderSelectorComponent` | LLM provider dropdown |
| `RagService` | HTTP + EventSource client for RAG endpoints |
| `TtsService` | HTTP client for TTS endpoint, audio blob management |

---

## 3. Milestones & Linear Task Breakdown

### How to Read This

```
Epic (Linear Project or Cycle)
  Story (Linear Issue, type: Story)
    Task (Linear Sub-issue or checklist item)
```

**Milestone = a shippable, testable vertical slice.** Each milestone ends with something you can demo.

---

### Milestone 1: Scaffold & Data Layer
**Goal:** Nx monorepo running, shared types defined, HN data flowing with caching.
**Demo:** `curl` an internal endpoint that returns cached HN search results.

#### Epic 1.1: Project Bootstrap

- **Story: Initialize Nx monorepo**
  - Create Nx workspace with `apps/api` (NestJS) and `apps/web` (Angular)
  - Create `libs/shared-types` library
  - Configure `tsconfig.base.json` path aliases
  - Add `.env.example` with all config keys
  - Verify `nx serve api` and `nx serve web` both start

- **Story: Define shared types**
  - Define `RagQuery`, `AgentResponse`, `AgentStep`, `AgentSource`
  - Define `StoryChunk`, `CommentChunk`, `ContextWindow`
  - Define `ToolDefinition`, `LlmMessage`, `LlmResponse`
  - Define `TtsRequest`
  - Export all from `@voxpopuli/shared-types`

#### Epic 1.2: HN Data Service

- **Story: Implement CacheModule**
  - Install `node-cache`
  - Implement `CacheService` with typed `getOrSet<T>()` pattern
  - Configure TTLs per data type
  - Add cache stats method (hits, misses, keys)

- **Story: Implement HnService (Algolia)**
  - HTTP client for `hn.algolia.com/api/v1`
  - `search(query, options)` with sort, min_points, max_results
  - `searchByDate(query, options)` for date-sorted results
  - Wrap all calls with CacheService (15 min TTL)
  - Type responses into shared types

- **Story: Implement HnService (Firebase)**
  - HTTP client for `hacker-news.firebaseio.com/v0`
  - `getItem(id)` with 1-hour cache
  - `getCommentTree(storyId, maxDepth)` with 30-comment cap
  - Parallel batching (10 concurrent), skip deleted/dead
  - 30 min cache per comment item

---

### Milestone 2: LLM & Chunker
**Goal:** Any of the 3 LLM providers can receive a prompt and return a response. Content fits token budgets.
**Demo:** A script sends an HN search result through the chunker and gets an LLM summary.

#### Epic 2.1: Content Chunker

- **Story: Implement ChunkerService**
  - `chunkStories()` -- extract metadata, strip HTML, count tokens
  - `chunkComments()` -- flatten tree, assign depth, strip HTML
  - `buildContext()` -- fit chunks into per-provider token budget
  - `formatForPrompt()` -- render context as LLM-ready string
  - Token counting utility (tiktoken or character-based estimate)

#### Epic 2.2: LLM Provider Stack

- **Story: Define LlmProviderInterface**
  - `chat()`, `formatTools()`, `buildToolResultMessage()`
  - Internal `LlmMessage` and `LlmResponse` types
  - `ChatOptions` type (temperature, maxTokens, tools)

- **Story: Implement GroqProvider**
  - OpenAI-compatible SDK setup
  - `chat()` with tool calling support
  - `formatTools()` -- OpenAI function format
  - `buildToolResultMessage()` -- `role: "tool"` messages
  - Env: `GROQ_API_KEY`

- **Story: Implement ClaudeProvider**
  - Anthropic SDK setup
  - `chat()` with tool_use content blocks
  - `formatTools()` -- Anthropic tool format
  - `buildToolResultMessage()` -- `tool_result` content blocks
  - Env: `ANTHROPIC_API_KEY`

- **Story: Implement MistralProvider**
  - Mistral SDK setup
  - `chat()` with tool calling support
  - `formatTools()` -- OpenAI-compatible function format
  - `buildToolResultMessage()` -- `role: "tool"` messages
  - Env: `MISTRAL_API_KEY`

- **Story: Implement LlmService facade**
  - Read `LLM_PROVIDER` from env at startup
  - Instantiate correct provider
  - Delegate all calls to active provider
  - Support per-request provider override

---

### Milestone 3: Agent Core
**Goal:** The ReAct loop works end-to-end. Ask a question, get a sourced answer.
**Demo:** `curl POST /api/rag/query` returns a full `AgentResponse` with steps and sources.

#### Epic 3.1: ReAct Agent

- **Story: Define agent tools**
  - `search_hn` tool definition (params, description, JSON schema)
  - `get_story` tool definition
  - `get_comments` tool definition
  - Export as `ToolDefinition[]`

- **Story: Write system prompt**
  - Role: HN research agent
  - Instructions: search strategically, read comments for signal, cite sources
  - Output format: synthesized answer with attributions
  - Constraints: max steps, no hallucination, say "I couldn't find" when empty

- **Story: Implement AgentService.run()**
  - ReAct loop: think -> act -> observe -> repeat
  - Tool dispatch to HnService via `executeTool()`
  - Chunk tool results via ChunkerService
  - Build native tool_result messages via provider
  - Max 7 steps, 60s timeout
  - Concurrent run semaphore (max 5)
  - Return `AgentResponse` with steps, sources, meta

#### Epic 3.2: RAG Endpoints

- **Story: Implement RagController**
  - `POST /api/rag/query` -- blocking, returns full AgentResponse
  - `GET /api/rag/stream` -- SSE with thought/action/observation/answer/error events
  - `GET /api/health` -- provider, cache stats, uptime
  - Rate limiting middleware (10/min per IP, 60/min global)
  - Query result caching (10 min TTL)
  - Input validation (query required, max 500 chars)

---

### Milestone 4: Frontend
**Goal:** Working chat UI with live reasoning visualization and source cards.
**Demo:** Open browser, ask a question, see the agent think in real time, get a sourced answer.

#### Epic 4.1: Core UI

- **Story: Implement ChatComponent**
  - Query input with submit button
  - Answer display with markdown rendering
  - Conversation-style layout (query bubble, answer bubble)
  - Loading state while agent runs

- **Story: Implement AgentStepsComponent**
  - Real-time step timeline fed by SSE
  - Step type icons (thought, action, observation)
  - Expandable raw results per step
  - Auto-scroll as steps arrive

- **Story: Implement SourceCardComponent**
  - Story title, author, point count
  - Direct link to HN thread
  - Compact card layout
  - Deduplicated source list below answer

- **Story: Implement ProviderSelectorComponent**
  - Dropdown: Groq / Mistral / Claude
  - Passes `provider` param to query
  - Shows active provider in meta bar

- **Story: Implement RagService**
  - `query(params)` -- POST to `/api/rag/query`
  - `stream(params)` -- EventSource to `/api/rag/stream`
  - Parse SSE events into typed observables
  - Error handling and retry

- **Story: Implement meta bar**
  - Provider used, tokens consumed, latency, cached status
  - Displayed below each answer

---

### Milestone 5: Voice Output
**Goal:** Click Listen on any answer and hear it narrated as a podcast.
**Demo:** Ask a question, get an answer, click Listen, hear the podcast-style narration.

#### Epic 5.1: TTS Backend

- **Story: Implement TtsService**
  - Install `elevenlabs` SDK
  - `rewriteForSpeech()` -- LLM call with podcast rewrite prompt
  - `streamAudio()` -- ElevenLabs streaming TTS API
  - `narrate()` -- full pipeline (rewrite + stream)
  - Voice config from env (voice ID, model ID)
  - Character count header for cost tracking

- **Story: Implement TtsController**
  - `POST /api/tts/narrate` -- streaming MP3 response
  - `GET /api/tts/voices` -- active narrator info
  - Input validation (text required, max length)
  - Rate limiting

- **Story: Write podcast rewrite prompt**
  - System prompt for conversational rewrite
  - Strip markdown, naturalize citations, add transitions
  - Target 800-1200 characters
  - Sign-off: "That's the signal from HN. I'm VoxPopuli."

#### Epic 5.2: TTS Frontend

- **Story: Implement AudioPlayerComponent**
  - Listen button on answer bubble
  - States: idle -> loading -> streaming -> paused -> complete
  - Play/pause, progress bar
  - Speed selector (0.75x / 1x / 1.25x / 1.5x)
  - Download MP3 button

- **Story: Implement TtsService (frontend)**
  - POST to `/api/tts/narrate`
  - Receive audio blob, create object URL
  - Feed to HTML5 `<audio>` element
  - Cleanup URLs on component destroy

---

### Milestone 6: Eval Harness
**Goal:** Automated quality checks catch regressions in agent behavior.
**Demo:** Run `npx tsx evals/run-eval.ts` and get a scored report.

#### Epic 6.1: Evaluation System

- **Story: Create eval test queries**
  - Write 20 queries in `evals/queries.json`
  - 5 categories: tool comparisons, opinion, specific projects, recent events, edge cases
  - Each with `expectedQualities`, `expectedMinSources`, `maxAcceptableSteps`

- **Story: Implement eval runner**
  - `evals/run-eval.ts` -- run each query through the agent
  - Collect AgentResponse + timing + token usage
  - Support `--compare` flag for multi-provider comparison
  - Save timestamped results to `evals/results/`

- **Story: Implement eval scoring**
  - `evals/score.ts` -- score each response
  - Source accuracy (HTTP 200 check on URLs)
  - Quality checklist (LLM-as-judge call)
  - Efficiency (steps vs maxAcceptableSteps)
  - Latency and cost scoring
  - Weighted aggregate score

---

## 4. Milestone Dependencies

```mermaid
graph LR
    M1["M1: Scaffold<br/>& Data Layer"] --> M2["M2: LLM<br/>& Chunker"]
    M2 --> M3["M3: Agent<br/>Core"]
    M3 --> M4["M4: Frontend"]
    M3 --> M5["M5: Voice<br/>Output"]
    M3 --> M6["M6: Eval<br/>Harness"]
    M4 --> M5

    style M1 fill:#dbeafe,stroke:#1e40af
    style M2 fill:#dbeafe,stroke:#1e40af
    style M3 fill:#fef3c7,stroke:#92400e
    style M4 fill:#d1fae5,stroke:#065f46
    style M5 fill:#ede9fe,stroke:#5b21b6
    style M6 fill:#fce7f3,stroke:#be185d
```

**Critical path:** M1 -> M2 -> M3 -> M4

**Parallel after M3:** M5 (voice) and M6 (evals) can run in parallel with M4, but M5's frontend depends on M4.

---

## 5. Implementation Order (Solo Dev)

As a solo developer, this is the recommended build order. Each milestone builds on the last and ends with something testable.

| Order | Milestone | Est. Stories | Depends On |
|-------|-----------|-------------|------------|
| 1 | M1: Scaffold & Data Layer | 5 | -- |
| 2 | M2: LLM & Chunker | 6 | M1 |
| 3 | M3: Agent Core | 4 | M2 |
| 4 | M6: Eval Harness | 3 | M3 |
| 5 | M4: Frontend | 6 | M3 |
| 6 | M5: Voice Output | 5 | M3, M4 |

**Why evals before frontend?** The eval harness catches agent regressions early. Build it as soon as the agent works. You'll tweak the system prompt, chunker, and token budgets many times -- evals prevent you from breaking what already works.

**Total: 6 milestones, 29 stories.**

---

## 6. Environment Configuration

```env
# LLM Provider (required)
LLM_PROVIDER=groq                          # claude | mistral | groq

# API Keys (only active provider required)
GROQ_API_KEY=gsk_...
MISTRAL_API_KEY=...
ANTHROPIC_API_KEY=sk-ant-...

# ElevenLabs TTS (required for voice output)
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=nPczCjzI2devNBz1zQrb   # Brian (default narrator)
ELEVENLABS_MODEL=eleven_multilingual_v2

# Server
PORT=3000
```

---

## 7. Key Technical Constraints

| Constraint | Value | Rationale |
|-----------|-------|-----------|
| Max agent steps | 7 | Cost + latency cap |
| Agent timeout | 60s | Prevent runaway loops |
| Concurrent agents | 5 | Prevent cost blowout |
| Comment cap | 30 per story | Firebase API latency |
| Query max length | 500 chars | Input sanity |
| Rate limit (per IP) | 10 req/min | Abuse prevention |
| Rate limit (global) | 60 req/min | Cost protection |
| Cache TTL (search) | 15 min | Freshness vs cost |
| Cache TTL (stories) | 1 hour | Stable data |
| Cache TTL (comments) | 30 min | Semi-stable data |
| Cache TTL (query result) | 10 min | Token savings |
| Token budget (Claude) | 80k of 200k | Conservative headroom |
| Token budget (Mistral) | 100k of 262k | Conservative headroom |
| Token budget (Groq) | 50k of 128k | Conservative headroom |
| TTS max chars | 2500 | ElevenLabs streaming limit |

---

## 8. Cross-References to product.md

| This Document | product.md |
|--------------|------------|
| Module specs (Section 2) | API contracts (Section 7), Tool specs (Section 8) |
| LLM providers (Section 2.5) | Provider architecture (Section 5), Native tool protocol (Section 9) |
| Token budgets (Section 2.4) | Data flow (Section 6.2) |
| TTS module (Section 2.8) | Voice output (Sections 3.8, 18) |
| Constraints (Section 7) | NFRs (Section 13), Rate limiting (Section 3.7) |
| Milestones (Section 3) | Roadmap (Section 14) |
