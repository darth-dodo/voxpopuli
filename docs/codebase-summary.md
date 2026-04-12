# VoxPopuli -- Codebase Summary

**Generated:** 2026-04-12
**Covers:** Milestones 1-4, 6-8 (Scaffold & Data Layer, LLM & Chunker, Agent Core, Frontend, Eval Harness, Deploy & Observability, Multi-Agent Pipeline)

---

## 1. Project Overview

VoxPopuli is an agentic RAG (Retrieval-Augmented Generation) system that turns Hacker News into a queryable knowledge base. A user submits a natural-language question; an autonomous research agent searches HN stories via Algolia, crawls comment threads from the Firebase API, reasons about the retrieved content through a ReAct loop, and delivers a sourced, synthesized answer. The system supports three LLM providers (Claude, Mistral, Groq), includes a planned voice-output layer via ElevenLabs TTS, and exposes full transparency into the agent's reasoning steps. A multi-agent pipeline (Retriever -> Synthesizer -> Writer) is available as an opt-in alternative to the single-agent ReAct loop, producing structured editorial responses via LangGraph orchestration.

---

## 2. Tech Stack

| Layer           | Technology              | Role                                                    |
| --------------- | ----------------------- | ------------------------------------------------------- |
| Monorepo        | Nx                      | Workspace orchestration, task running, dependency graph |
| Backend         | NestJS 11+              | API framework with module-based DI                      |
| Frontend        | Angular 17+             | SPA with standalone components, signals, Tailwind v4    |
| LLM (quality)   | Claude Haiku 4.5        | Anthropic SDK via LangChain `@langchain/anthropic`      |
| LLM (cost)      | Mistral Large 3         | Mistral SDK via LangChain `@langchain/mistralai`        |
| LLM (speed)     | Groq Qwen3 32B          | OpenAI-compatible via LangChain `@langchain/groq`       |
| Agent           | LangChain `createAgent` | ReAct loop with `tool()` helper and Zod schemas         |
| TTS             | ElevenLabs              | Planned -- podcast-style voice narration                |
| Cache           | node-cache              | In-memory TTL cache with typed get/set                  |
| Shared types    | TypeScript lib          | `@voxpopuli/shared-types` consumed by both apps         |
| Logging         | Pino (nestjs-pino)      | Structured JSON logging, pretty-print in dev            |
| Validation      | class-validator + Zod   | Environment validation + agent tool schemas             |
| HTTP client     | @nestjs/axios           | Algolia and Firebase API calls with retry + backoff     |
| Package manager | pnpm                    | Workspace-aware dependency management                   |
| CI              | GitHub Actions          | Lint and test on affected projects                      |

---

## 3. Milestone Progress

| Milestone | Name                   | Status      | Description                                                                        |
| --------- | ---------------------- | ----------- | ---------------------------------------------------------------------------------- |
| M1        | Scaffold & Data Layer  | Complete    | Nx monorepo, shared types, CacheService, HnService, health endpoint, CI, Docker    |
| M2        | LLM & Chunker          | Complete    | ChunkerService, LlmProviderInterface, 3 providers, LlmService facade               |
| M3        | Agent Core             | Complete    | ReAct agent, RAG endpoints, trust framework, error handling                        |
| M4        | Frontend               | Complete    | Chat UI, agent steps, source cards, trust bar, provider selector, landing page     |
| M5        | Voice Output           | Not started | TTS backend + frontend audio player                                                |
| M6        | Eval Harness           | Complete    | 27-query eval suite, 5 evaluators, LangSmith integration, CLI runner               |
| M7        | Deploy & Observability | ~87%        | Dockerfile, docker-compose, Render deploy, CORS fixes, Pino logging                |
| M8        | Multi-Agent Pipeline   | Complete    | LangGraph pipeline (Retriever/Synthesizer/Writer), per-stage retry, SSE resilience |

---

## 4. Repository Structure

```
voxpopuli/
+-- apps/
|   +-- api/
|   |   +-- src/
|   |       +-- app/                 # AppModule, AppController, AppService, main.ts
|   |       +-- agent/               # AgentModule, AgentService, OrchestratorService, pipeline nodes
|   |       |   +-- agent.service.ts          # Legacy ReAct loop via LangChain createAgent
|   |       |   +-- agent.service.spec.ts     # 10 integration tests
|   |       |   +-- agent.module.ts           # NestJS module (imports Hn, Chunker, Llm)
|   |       |   +-- orchestrator.service.ts   # Multi-agent pipeline coordinator (LangGraph)
|   |       |   +-- orchestrator.service.spec.ts # 10 tests
|   |       |   +-- tools.ts                  # search_hn, get_story, get_comments
|   |       |   +-- system-prompt.ts          # Agent system prompt with claim taxonomy
|   |       |   +-- trust.ts                  # computeTrustMetadata (pure function)
|   |       |   +-- partial-response.ts       # buildPartialResponse (graceful degradation)
|   |       |   +-- fallback-response.ts      # buildFallbackResponse (Writer failure fallback)
|   |       |   +-- fallback-response.spec.ts # 8 tests
|   |       |   +-- nodes/                    # Pipeline stage implementations
|   |       |   |   +-- retriever.node.ts     # ReAct + compaction -> EvidenceBundle
|   |       |   |   +-- synthesizer.node.ts   # EvidenceBundle -> AnalysisResult
|   |       |   |   +-- writer.node.ts        # AnalysisResult -> AgentResponseV2
|   |       |   |   +-- parse-llm-json.ts     # JSON parse safety (strip fences, retry)
|   |       |   |   +-- *.spec.ts             # 4+5+4 node tests
|   |       |   +-- prompts/                  # Pipeline stage system prompts
|   |       |       +-- retriever.prompt.ts   # ReAct collection strategy
|   |       |       +-- compactor.prompt.ts   # Raw data -> structured EvidenceBundle
|   |       |       +-- synthesizer.prompt.ts # Bundle -> insights + contradictions
|   |       |       +-- writer.prompt.ts      # Analysis -> editorial prose
|   |       +-- cache/               # CacheModule, CacheService
|   |       +-- chunker/             # ChunkerModule, ChunkerService, chunker.service.spec.ts
|   |       +-- config/              # env.validation.ts (class-validator schema)
|   |       +-- health/              # HealthModule, HealthController, health.controller.spec.ts
|   |       +-- hn/                  # HnModule, HnService, HnController, hn.service.spec.ts
|   |       +-- llm/                 # LlmModule, LlmService, llm-provider.interface.ts
|   |       |   +-- providers/       # groq.provider.ts, claude.provider.ts, mistral.provider.ts
|   |       +-- rag/                 # RagModule, RagController, rate limiting, input validation
|   |           +-- rag.controller.ts         # POST /query, GET /stream (SSE)
|   |           +-- rag.controller.spec.ts    # 7 integration tests
|   |           +-- rag.module.ts             # NestJS module (imports AgentModule)
|   |           +-- dto/                      # RagQueryDto (class-validator)
|   |           +-- filters/                  # HttpExceptionFilter (global error handler)
|   +-- api-e2e/                     # E2E test harness (api.spec.ts)
|   +-- web/                         # Angular frontend
|   |   +-- src/app/
|   |       +-- components/
|   |       |   +-- chat/             # ChatComponent -- query input, answer display, SSE streaming
|   |       |   +-- agent-steps/      # AgentStepsComponent -- expandable reasoning timeline
|   |       |   +-- source-card/      # SourceCardComponent -- HN story card with metadata
|   |       |   +-- trust-bar/        # TrustBarComponent -- visual trust indicators
|   |       |   +-- provider-selector/ # ProviderSelectorComponent -- LLM provider dropdown
|   |       |   +-- meta-bar/         # MetaBarComponent -- token count, duration, provider info
|   |       +-- pages/
|   |       |   +-- design-system/    # Design system showcase page
|   |       +-- services/
|   |       |   +-- rag.service.ts    # HTTP + SSE client for RAG endpoints (legacy + pipeline)
|   |       +-- app.component.ts      # Product landing page with hero + example questions
|   +-- web-e2e/                     # Frontend E2E placeholder
+-- libs/
|   +-- shared-types/src/lib/        # API contracts, trust framework, pipeline types
|   |   +-- shared-types.ts          # Core types (AgentResponse, RagQuery, trust, HN data)
|   |   +-- evidence.types.ts        # EvidenceBundle, EvidenceItem, ThemeGroup, SourceMetadata
|   |   +-- analysis.types.ts        # AnalysisResult, Insight, Contradiction
|   |   +-- response-v2.types.ts     # AgentResponseV2, ResponseSection
|   |   +-- pipeline.types.ts        # PipelineConfig, PipelineEvent, PipelineResult, PipelineState
|   |   +-- *.spec.ts                # Zod schema validation tests (7+6)
+-- evals/                           # Eval harness (M6)
|   +-- queries.json                 # 27 test queries (20 general + 7 trust-specific)
|   +-- run-eval.ts                  # CLI entry point (commander)
|   +-- evaluators/                  # source-accuracy, quality-judge, efficiency, latency, cost
|   +-- dataset.ts                   # LangSmith dataset sync helper
|   +-- score.ts                     # Score aggregation and reporting
|   +-- feedback.ts                  # Post eval scores to LangSmith as run feedback
|   +-- types.ts                     # EvalQuery, EvalRunResult, EvalScore, EvalReport
|   +-- __tests__/                   # 7 score tests
|   +-- evaluators/__tests__/        # 25 evaluator tests
|   +-- results/                     # Eval run output JSON files
+-- docs/
|   +-- adr/                         # ADR-002 through ADR-006
|   +-- adrs/                        # ADR-001
|   +-- plans/                       # Design documents and implementation plans
|   +-- codebase-summary.md          # This file
+-- .env.example                     # Environment variable template
+-- architecture.md                  # Technical architecture and milestone breakdown
+-- product.md                       # Product specification v2.0.0
+-- Dockerfile                       # Container build
+-- docker-compose.yml               # Local container orchestration
+-- Makefile                         # Development command shortcuts
+-- nx.json                          # Nx workspace configuration
+-- package.json                     # Root dependencies
+-- pnpm-workspace.yaml              # pnpm workspace config
+-- eslint.config.mjs                # ESLint configuration
+-- tsconfig.base.json               # Base TypeScript config with path aliases
```

---

## 5. Module Inventory

### 5.1 CacheModule (`apps/api/src/cache/`)

| Attribute    | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| Purpose      | In-memory TTL cache wrapping `node-cache`                                 |
| Scope        | `@Global()` -- available to all modules without explicit import           |
| Key class    | `CacheService`                                                            |
| Key methods  | `getOrSet<T>(key, fetcher, ttl)`, `get<T>(key)`, `del(key)`, `getStats()` |
| Test file    | None (tested indirectly through HnService and integration tests)          |
| Dependencies | `node-cache`, `@voxpopuli/shared-types` (CacheStats)                      |

### 5.2 HealthModule (`apps/api/src/health/`)

| Attribute    | Value                                                                             |
| ------------ | --------------------------------------------------------------------------------- |
| Purpose      | Lightweight health-check endpoint for load balancers and status indicators        |
| Key class    | `HealthController`                                                                |
| Key methods  | `GET /api/health` returns `HealthResponse` (status, uptime, cacheStats)           |
| Test file    | `health.controller.spec.ts`                                                       |
| Dependencies | `@voxpopuli/shared-types` (HealthResponse)                                        |
| Note         | Currently returns hardcoded cache stats (0/0/0); does not inject CacheService yet |

### 5.3 HnModule (`apps/api/src/hn/`)

| Attribute    | Value                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| Purpose      | Hacker News data retrieval from Algolia (search) and Firebase (items, comment trees)                           |
| Key class    | `HnService`                                                                                                    |
| Key methods  | `search(query, options)`, `searchByDate(query, options)`, `getItem(id)`, `getCommentTree(storyId, maxDepth)`   |
| Controller   | `HnController` -- temporary test endpoints (`/api/hn/search`, `/api/hn/item/:id`, `/api/hn/comments/:storyId`) |
| Test file    | `hn.service.spec.ts`                                                                                           |
| Dependencies | `@nestjs/axios` (HttpModule), `CacheService`, `@voxpopuli/shared-types`                                        |
| Cache TTLs   | Search: 900s (15 min), Story: 3600s (1 hr), Comment: 1800s (30 min)                                            |
| Constraints  | 30 comment cap, 15 top-level max, batch size 10, max depth 3                                                   |
| Retry logic  | `retryWithBackoff()` -- 3 attempts, exponential backoff with jitter, retries on 5xx/network errors only        |

### 5.4 ChunkerModule (`apps/api/src/chunker/`)

| Attribute        | Value                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose          | Token-aware chunking of HN stories/comments and context window assembly                                                                                           |
| Key class        | `ChunkerService`                                                                                                                                                  |
| Key methods      | `estimateTokens(text)`, `stripHtml(html)`, `chunkStories(hits)`, `chunkComments(comments)`, `buildContext(stories, comments, budget)`, `formatForPrompt(context)` |
| Test file        | `chunker.service.spec.ts`                                                                                                                                         |
| Dependencies     | `@voxpopuli/shared-types` (StoryChunk, CommentChunk, ContextWindow, HnSearchHit, HnComment)                                                                       |
| Token estimation | Character-based: 1 token ~ 4 characters                                                                                                                           |
| Budget priority  | Metadata > story text > top-level comments (depth 0-1) > nested comments (depth 2+)                                                                               |

### 5.5 LlmModule (`apps/api/src/llm/`)

| Attribute    | Value                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------- |
| Purpose      | LLM provider facade with lazy instantiation and provider switching                           |
| Key class    | `LlmService`                                                                                 |
| Key methods  | `getModel(providerOverride?)`, `getMaxContextTokens(providerOverride?)`, `getProviderName()` |
| Test file    | `llm.service.spec.ts`                                                                        |
| Dependencies | `ConfigService`, all three provider classes                                                  |

**Providers:**

| Provider | Class             | LangChain Model | Model ID                    | Context Window |
| -------- | ----------------- | --------------- | --------------------------- | -------------- |
| Groq     | `GroqProvider`    | `ChatGroq`      | `qwen/qwen3-32b`            | 128,000 tokens |
| Claude   | `ClaudeProvider`  | `ChatAnthropic` | `claude-haiku-4-5-20251001` | 200,000 tokens |
| Mistral  | `MistralProvider` | `ChatMistralAI` | `mistral-large-latest`      | 262,000 tokens |

All providers implement `LlmProviderInterface` with three members: `name`, `maxContextTokens`, and `getModel()`. Each wraps a LangChain `BaseChatModel` instance that is lazily created on first access.

### 5.6 AgentModule (`apps/api/src/agent/`)

| Attribute       | Value                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Purpose         | ReAct reasoning agent and multi-agent pipeline for HN search and synthesis                                                 |
| Key classes     | `AgentService` (legacy ReAct), `OrchestratorService` (multi-agent pipeline)                                                |
| Test files      | `agent.service.spec.ts` (10), `orchestrator.service.spec.ts` (10), `fallback-response.spec.ts` (8), node specs (13)        |
| Dependencies    | `LlmService`, `HnService`, `ChunkerService`, `langchain` (createAgent), `@langchain/langgraph`, `zod`                      |
| Agent framework | LangChain `createAgent` (v1.2+) with `tool()` helper and Zod schemas                                                       |
| Constraints     | Max 7 steps (`recursionLimit`) with action count guard, 60s timeout (`AbortSignal`), 5 concurrent runs (counter semaphore) |
| Feature flag    | Pipeline activated via `useMultiAgent` query param on SSE endpoint (default `false`)                                       |

**Tools** (defined in `tools.ts`):

| Tool           | Wraps                           | Returns                                   |
| -------------- | ------------------------------- | ----------------------------------------- |
| `search_hn`    | `HnService.search/searchByDate` | Chunked story metadata via ChunkerService |
| `get_story`    | `HnService.getItem`             | Formatted story details with posted date  |
| `get_comments` | `HnService.getCommentTree`      | Chunked comment tree via ChunkerService   |

**OrchestratorService** (multi-agent pipeline):

| Attribute  | Value                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Purpose    | LangGraph StateGraph pipeline: Retriever -> Synthesizer -> Writer producing structured editorial responses |
| Stages     | `retriever` (ReAct + compaction), `synthesizer` (evidence analysis), `writer` (editorial prose)            |
| Config     | `PipelineConfig` -- per-stage provider mapping, token budgets, 30s default timeout                         |
| Recovery   | Synthesizer retries once; Writer retries once then falls back to `buildFallbackResponse()`                 |
| SSE events | Emits `pipeline` events at stage transitions; legacy `thought`/`action`/`observation` from inner ReAct     |

**Pipeline nodes** (`nodes/`):

| Node                  | Input -> Output                       | Key behavior                                               |
| --------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `retriever.node.ts`   | query -> `EvidenceBundle`             | Runs ReAct agent to collect HN data, then compacts via LLM |
| `synthesizer.node.ts` | `EvidenceBundle` -> `AnalysisResult`  | Extracts insights, contradictions, confidence, gaps        |
| `writer.node.ts`      | `AnalysisResult` -> `AgentResponseV2` | Produces editorial prose with sections and citations       |
| `parse-llm-json.ts`   | LLM text -> parsed JSON               | Strips markdown fences, retries on parse failure           |

**Supporting files:**

| File                   | Purpose                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `system-prompt.ts`     | Agent role, search strategy, claim taxonomy (evidence/consensus/anecdote/opinion), honesty rules                |
| `trust.ts`             | `computeTrustMetadata()` -- source verification, recency, viewpoint diversity, Show HN detection, honesty flags |
| `partial-response.ts`  | `buildPartialResponse()` -- returns collected data when LLM fails mid-loop                                      |
| `fallback-response.ts` | `buildFallbackResponse()` -- constructs response from AnalysisResult when Writer fails                          |
| `prompts/*.prompt.ts`  | System prompts for retriever, compactor, synthesizer, and writer stages                                         |

### 5.7 RagModule (`apps/api/src/rag/`)

| Attribute    | Value                                                                             |
| ------------ | --------------------------------------------------------------------------------- |
| Purpose      | HTTP API layer for RAG queries with caching, rate limiting, and structured errors |
| Key class    | `RagController`                                                                   |
| Test file    | `rag.controller.spec.ts` (7 tests)                                                |
| Dependencies | `AgentService`, `CacheService`                                                    |

**Endpoints:**

| Endpoint          | Method | Description                                                        |
| ----------------- | ------ | ------------------------------------------------------------------ |
| `/api/rag/query`  | POST   | Blocking full `AgentResponse`, cached 10 min                       |
| `/api/rag/stream` | GET    | SSE streaming, accepts `provider` and `useMultiAgent` query params |

**Supporting files:**

| File                               | Purpose                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `dto/rag-query.dto.ts`             | Input validation: query (required, max 500 chars), maxSteps (1-7), provider           |
| `filters/http-exception.filter.ts` | Global exception filter: 400/429/502/500 mapping, structured JSON error body, logging |

**Rate limiting:** Global 60 req/min via timestamp array (no per-IP tracking, no external dependency).

**SSE model:** Legacy mode uses post-completion replay. Pipeline mode (`useMultiAgent=true`) emits `pipeline` events at stage transitions alongside legacy `thought`/`action`/`observation` events from the Retriever's inner ReAct loop. Frontend `RagService` includes retry logic, heartbeat detection, and visibility-aware reconnection for mobile resilience.

### 5.8 ConfigModule (`apps/api/src/config/`)

| Attribute          | Value                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose            | Environment variable validation at application startup                                                                                                   |
| Key export         | `validate()` function used by `ConfigModule.forRoot()`                                                                                                   |
| Validation library | `class-validator` + `class-transformer`                                                                                                                  |
| Key class          | `EnvironmentVariables` with decorated fields                                                                                                             |
| Required vars      | `LLM_PROVIDER` (default: `groq`)                                                                                                                         |
| Optional vars      | `GROQ_API_KEY`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`, `PORT`, `LOG_LEVEL`, `NODE_ENV` |

### 5.9 AppModule (`apps/api/src/app/`)

| Attribute | Value                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose   | Root NestJS module wiring all feature modules together                                                                                                    |
| Imports   | `ConfigModule` (global), `LoggerModule` (pino), `CacheModule`, `HealthModule`, `HnModule`, `ChunkerModule`, `LlmModule`, `AgentModule`, `RagModule`       |
| Bootstrap | `main.ts` configures global prefix (`/api`), CORS (localhost:4200), graceful shutdown, Pino logger, global `ValidationPipe`, global `HttpExceptionFilter` |

---

## 6. Shared Types

All types are exported from `@voxpopuli/shared-types`. Core interfaces live in `shared-types.ts`; pipeline types are split across `evidence.types.ts`, `analysis.types.ts`, `response-v2.types.ts`, and `pipeline.types.ts`.

### Core Query/Response

| Interface       | Purpose                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `RagQuery`      | Inbound query shape: `query`, `maxSteps?`, `includeComments?`, `provider?`                    |
| `AgentResponse` | Top-level response: `answer`, `steps[]`, `sources[]`, `trust`, `meta`                         |
| `AgentStep`     | Single reasoning step: type (`thought`/`action`/`observation`), content, tool info, timestamp |
| `AgentSource`   | Referenced HN story: storyId, title, url, author, points, commentCount                        |
| `AgentMeta`     | Run metadata: provider, token counts, duration, cached flag, error flag                       |

### Trust Framework

| Interface              | Purpose                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `TrustMetadata`        | Trust signals: sourcesVerified/Total, avgSourceAge, recentSourceRatio, viewpointDiversity, showHnCount, honestyFlags |
| `RewriteTrustMetadata` | TTS rewrite trust: factPreservation, attributionsRetained, toneAlignment                                             |
| `Claim`                | Extracted claim: text, type (evidence/anecdote/opinion/consensus), attribution, confidence                           |

### HN Data Types

| Interface         | Purpose                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `HnSearchResult`  | Algolia response shape: hits, pagination metadata                                  |
| `HnSearchHit`     | Single Algolia hit: objectID, title, url, author, points, num_comments, story_text |
| `HnStory`         | Firebase story: id, by, time, title, url, text, score, descendants, kids           |
| `HnComment`       | Firebase comment: id, by, time, text, parent, kids, deleted, dead, depth           |
| `HnSearchOptions` | Search filters: minPoints, hitsPerPage                                             |

### Context Window Chunks

| Interface       | Purpose                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `StoryChunk`    | Token-counted story segment: storyId, title, author, points, url, text, tokenCount |
| `CommentChunk`  | Token-counted comment segment: commentId, storyId, author, text, depth, tokenCount |
| `ContextWindow` | Assembled context: stories[], comments[], totalTokens, truncated flag              |

### LLM/Tool Types

| Interface        | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `ToolDefinition` | Agent tool descriptor: name, description, JSON schema        |
| `LlmMessage`     | Provider-agnostic message: role, content, toolCallId         |
| `LlmResponse`    | Provider-agnostic response: content, toolCalls, token counts |
| `ToolCall`       | Tool invocation: id, name, arguments                         |
| `ChatOptions`    | LLM call options: temperature, maxTokens, tools              |

### TTS

| Interface    | Purpose                                        |
| ------------ | ---------------------------------------------- |
| `TtsRequest` | Narration request: text, rewrite flag, voiceId |

### Pipeline: Evidence (`evidence.types.ts`)

| Interface        | Purpose                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `SourceMetadata` | HN story metadata for source tracking: storyId, title, url, author, points, commentCount           |
| `EvidenceItem`   | Single evidence piece: sourceId, text, type (evidence/anecdote/opinion/consensus), relevance score |
| `ThemeGroup`     | Thematic grouping of evidence items: label, items[]                                                |
| `EvidenceBundle` | Compacted output from Retriever: query, themes[], allSources[], totalSourcesScanned, tokenCount    |

### Pipeline: Analysis (`analysis.types.ts`)

| Interface        | Purpose                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `Insight`        | Derived insight: claim, reasoning, evidenceStrength (strong/moderate/weak), themeIndices        |
| `Contradiction`  | Conflicting sources: claim, counterClaim, sourceIds                                             |
| `AnalysisResult` | Synthesizer output: summary, insights[], contradictions[], confidence (high/medium/low), gaps[] |

### Pipeline: Response V2 (`response-v2.types.ts`)

| Interface         | Purpose                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `ResponseSection` | Themed section: heading, body, citedSources[]                             |
| `AgentResponseV2` | Writer output: headline, context, sections[] (2-4), bottomLine, sources[] |

### Pipeline: Orchestration (`pipeline.types.ts`)

| Interface        | Purpose                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| `PipelineStage`  | Stage enum: `retriever`, `synthesizer`, `writer`                                       |
| `StageStatus`    | Status enum: `started`, `progress`, `done`, `error`                                    |
| `PipelineEvent`  | SSE event at stage transitions: stage, status, detail, elapsed                         |
| `PipelineConfig` | Config: useMultiAgent flag, per-stage providerMap, tokenBudgets, timeout (default 30s) |
| `PipelineResult` | Full result: response, bundle, analysis, events[], durationMs                          |
| `PipelineState`  | LangGraph accumulator: query, bundle?, analysis?, response?, events[], error?          |

All pipeline types use Zod schemas with runtime validation and inferred TypeScript types.

### Operational

| Interface        | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `CacheStats`     | Cache metrics: hits, misses, keys                    |
| `HealthResponse` | Health endpoint response: status, uptime, cacheStats |

---

## 7. Configuration

### Environment Variables

| Variable              | Required              | Default                  | Purpose                                              |
| --------------------- | --------------------- | ------------------------ | ---------------------------------------------------- |
| `LLM_PROVIDER`        | Yes                   | `groq`                   | Active LLM provider (`groq`, `claude`, or `mistral`) |
| `GROQ_API_KEY`        | When provider=groq    | --                       | Groq API authentication                              |
| `MISTRAL_API_KEY`     | When provider=mistral | --                       | Mistral API authentication                           |
| `ANTHROPIC_API_KEY`   | When provider=claude  | --                       | Anthropic API authentication                         |
| `ELEVENLABS_API_KEY`  | For M5 (TTS)          | --                       | ElevenLabs TTS authentication                        |
| `ELEVENLABS_VOICE_ID` | For M5 (TTS)          | `nPczCjzI2devNBz1zQrb`   | ElevenLabs narrator voice (Brian)                    |
| `ELEVENLABS_MODEL`    | For M5 (TTS)          | `eleven_multilingual_v2` | ElevenLabs model selection                           |
| `PORT`                | No                    | `3000`                   | HTTP server port                                     |
| `LOG_LEVEL`           | No                    | `info`                   | Pino log level                                       |
| `NODE_ENV`            | No                    | `development`            | Enables pretty-printed logs in non-production        |

### Validation

Environment variables are validated at startup using `class-validator` in `apps/api/src/config/env.validation.ts`. The `validate()` function is passed to `ConfigModule.forRoot()` in `AppModule`. Invalid configuration causes the application to fail fast with a descriptive error.

---

## 8. Architecture Decision Records

| ADR     | Title                                                | Date       | Summary                                                                                                                   |
| ------- | ---------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 | CI/CD Pipeline and Quality Gates                     | 2026-04-03 | Defines GitHub Actions CI pipeline and pre-commit hook strategy for lint/test quality gates                               |
| ADR-002 | Chunker Strategy and Token Budget Design             | 2026-04-04 | Character-based token estimation (1 token ~ 4 chars), 4-phase priority budget allocation, HTML-to-markdown conversion     |
| ADR-003 | LLM Provider Architecture and Tool Protocol Design   | 2026-04-04 | LangChain-based provider interface with facade pattern, lazy instantiation, and native tool-calling protocol per provider |
| ADR-004 | ReAct Agent Design and Tool Selection Strategy       | 2026-04-04 | LangChain `createAgent` (v1.2+), 3-tool design, chunked string output, safety constraints, SSE streaming integration      |
| ADR-005 | True Mid-Loop SSE Streaming via AsyncGenerator       | 2026-04-05 | AsyncGenerator-based mid-loop SSE streaming for real-time agent step visualization                                        |
| ADR-006 | Adaptive Query Decomposition in the Retriever Prompt | 2026-04-11 | Query-type-aware search strategies in Retriever prompt, extending ADR-004                                                 |

### Design Documents

| Document                            | Date       | Scope                                                                                  |
| ----------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| M1: Scaffold & Data Layer Design    | 2026-04-01 | Nx monorepo structure, CacheService design, HnService API design, health endpoint spec |
| Result Page Redesign                | 2026-04-06 | Frontend result page layout and UX improvements                                        |
| M6: Eval Harness Design             | 2026-04-08 | Evaluation framework, scoring, LangSmith integration                                   |
| M8: Implementation Plan             | 2026-04-09 | Multi-agent pipeline implementation strategy                                           |
| M8: Multi-Agent Pipeline Design     | 2026-04-09 | LangGraph pipeline architecture (Retriever/Synthesizer/Writer)                         |
| Adaptive Query Decomposition Design | 2026-04-11 | Query decomposition strategy for complex questions                                     |
| Orchestrator Failure Recovery       | 2026-04-11 | Per-stage failure recovery and circuit breaker design                                  |
| LangGraph Orchestrator Refactor     | 2026-04-12 | StateGraph refactor for OrchestratorService                                            |

---

## 9. Test Summary

### API Tests (Jest via Nx)

| Test Suite          | File                                        | Tests | Covers                                                                                     |
| ------------------- | ------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| HealthController    | `health/health.controller.spec.ts`          | 2     | Health endpoint response shape and values                                                  |
| HnService           | `hn/hn.service.spec.ts`                     | 10    | Algolia search, Firebase fetch, comment tree, caching, error handling, retry logic         |
| ChunkerService      | `chunker/chunker.service.spec.ts`           | 57    | Token estimation, HTML stripping, story/comment chunking, context assembly, formatting     |
| LlmService          | `llm/llm.service.spec.ts`                   | 22    | Provider resolution, lazy instantiation, provider override, unknown provider errors        |
| AgentService        | `agent/agent.service.spec.ts`               | 10    | Agent execution, concurrency limits, semaphore cleanup, prompt template, source extraction |
| OrchestratorService | `agent/orchestrator.service.spec.ts`        | 10    | Pipeline execution, stage transitions, failure recovery, config handling                   |
| FallbackResponse    | `agent/fallback-response.spec.ts`           | 8     | Writer fallback construction from AnalysisResult                                           |
| RetrieverNode       | `agent/nodes/retriever.node.spec.ts`        | 4     | ReAct collection, compaction, EvidenceBundle output                                        |
| SynthesizerNode     | `agent/nodes/synthesizer.node.spec.ts`      | 5     | Evidence analysis, insight extraction, contradiction detection                             |
| WriterNode          | `agent/nodes/writer.node.spec.ts`           | 4     | Editorial prose generation, section structure, citations                                   |
| RagController       | `rag/rag.controller.spec.ts`                | 7     | POST cached/uncached, SSE events, error handling, input validation, rate limiting          |
| HttpExceptionFilter | `rag/filters/http-exception.filter.spec.ts` | 10    | Status code mapping, error body structure, timestamp, 429/502 handling                     |

### Shared Types Tests (Jest via Nx)

| Test Suite    | File                                      | Tests | Covers                                                             |
| ------------- | ----------------------------------------- | ----- | ------------------------------------------------------------------ |
| EvidenceTypes | `shared-types/lib/evidence.types.spec.ts` | 7     | Zod schema validation for EvidenceBundle, EvidenceItem, ThemeGroup |
| AnalysisTypes | `shared-types/lib/analysis.types.spec.ts` | 6     | Zod schema validation for AnalysisResult, Insight, Contradiction   |

### Eval Tests (Vitest)

| Test Suite     | File                                                 | Tests | Covers                                                 |
| -------------- | ---------------------------------------------------- | ----- | ------------------------------------------------------ |
| Score          | `evals/__tests__/score.test.ts`                      | 7     | Score aggregation, weighted scoring, report generation |
| SourceAccuracy | `evals/evaluators/__tests__/source-accuracy.test.ts` | 5     | Source verification against HN data                    |
| QualityJudge   | `evals/evaluators/__tests__/quality-judge.test.ts`   | 6     | LLM-as-judge scoring with fence stripping              |
| Efficiency     | `evals/evaluators/__tests__/efficiency.test.ts`      | 5     | Token and step efficiency scoring                      |
| Latency        | `evals/evaluators/__tests__/latency.test.ts`         | 5     | Response time threshold evaluation                     |
| Cost           | `evals/evaluators/__tests__/cost.test.ts`            | 4     | Per-query cost calculation by provider                 |

### Frontend Tests (Vitest via Nx)

| Test Suite | File                      | Tests | Covers                        |
| ---------- | ------------------------- | ----- | ----------------------------- |
| Web App    | `web/src/app/app.spec.ts` | 1     | Angular app component renders |

**Totals:** 20 test suites, ~195 tests (API: 149, Shared Types: 13, Eval: 32, Web: 1). API test runner: Jest via Nx. Eval test runner: Vitest. Web test runner: Vitest via Nx. All external HTTP calls and LLM providers are mocked in tests.

**Jest ESM note:** Test files that import `AgentService` or `LlmService` must mock the LLM provider modules to avoid `@langchain/*` ESM resolution failures. See `agent.service.spec.ts` for the pattern.

---

## 10. What's Next

**M5: Voice Output** (not started) -- ElevenLabs TTS backend integration and frontend audio player for podcast-style narration of agent responses.

**M7: Deploy & Observability** (~87% complete) -- Remaining items: production monitoring dashboards, alerting setup.

**M8: Pipeline Hardening** (complete) -- LangGraph StateGraph refactor, circuit breaker, SSE mobile resilience with retry/heartbeat/visibility detection, per-stage failure recovery, step streaming.
