# VoxPopuli -- Codebase Summary

**Generated:** 2026-04-15 (refreshed 2026-10-03)
**Covers:** Milestones 1-8 (Scaffold & Data Layer, LLM & Chunker, Agent Core, Frontend, Voice Output, Eval Harness, Deploy & Observability, Multi-Agent Pipeline) plus the post-M8 latency work (ADR-009), fail-fast on bad API keys, streaming drafts, answer replay, follow-up questions, and the opt-in merged writer (ADR-010)

---

## 1. Project Overview

VoxPopuli is an agentic RAG (Retrieval-Augmented Generation) system that turns Hacker News into a queryable knowledge base. A user submits a natural-language question; an autonomous research agent searches HN stories via Algolia, crawls comment threads from the Firebase API, reasons about the retrieved content through a ReAct loop, and delivers a sourced, synthesized answer. The system supports three LLM providers (Mistral, Claude, and OpenRouter), includes a voice-output layer via Mistral Voxtral TTS, and exposes full transparency into the agent's reasoning steps. The default execution path is the LangGraph multi-agent pipeline (Retriever -> Synthesizer -> Writer), which produces structured editorial responses with per-stage retry and fallback. The Writer streams a live draft of the answer while it generates. Completed answers are replayed to identical questions for 15 minutes, and a finished answer's evidence can be reused to answer follow-up questions without searching HN again. The legacy single-agent ReAct loop remains available via the `useMultiAgent=false` query parameter and is used as the pipeline's fallback, but is no longer the primary path. The default LLM provider is Mistral.

---

## 2. Tech Stack

| Layer           | Technology                             | Role                                                                   |
| --------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Monorepo        | Nx 22                                  | Workspace orchestration, task running, dependency graph                |
| Backend         | NestJS 11+                             | API framework with module-based DI                                     |
| Frontend        | Angular 21                             | SPA with standalone components, signals, Tailwind v4, `ngx-markdown`   |
| LLM (default)   | Mistral Small (`mistral-small-latest`) | Mistral SDK via LangChain `@langchain/mistralai`                       |
| LLM (quality)   | Claude Haiku 4.5                       | Anthropic SDK via LangChain `@langchain/anthropic`                     |
| LLM (cost)      | OpenRouter Qwen3 235B A22B             | OpenAI-compatible via LangChain `@langchain/openai`                    |
| Agent           | LangChain `createAgent`                | Legacy ReAct loop with `tool()` helper and Zod schemas                 |
| Pipeline        | LangGraph `StateGraph`                 | Retriever -> Synthesizer -> Writer, custom events for steps and drafts |
| TTS             | Mistral Voxtral                        | `voxtral-mini-tts-latest`, podcast-style narration (MP3)               |
| Cache           | lru-cache                              | In-memory LRU cache with per-entry TTL and typed get/set               |
| Shared types    | TypeScript lib                         | `@voxpopuli/shared-types` consumed by both apps                        |
| Logging         | Pino (nestjs-pino)                     | Structured JSON logging, pretty-print in dev                           |
| Error tracking  | Sentry (`@sentry/nestjs`)              | Enabled only when `SENTRY_DSN` is set                                  |
| Security        | helmet                                 | CSP and security headers                                               |
| Validation      | class-validator + Zod                  | Environment and DTO validation + agent tool and pipeline schemas       |
| HTTP client     | @nestjs/axios                          | Algolia and Firebase API calls with retry + backoff                    |
| Package manager | pnpm                                   | Workspace-aware dependency management                                  |
| CI              | GitHub Actions                         | Lint and test on affected projects                                     |

---

## 3. Milestone Progress

| Milestone | Name                   | Status   | Description                                                                                                             |
| --------- | ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| M1        | Scaffold & Data Layer  | Complete | Nx monorepo, shared types, CacheService, HnService, health endpoint, CI, Docker                                         |
| M2        | LLM & Chunker          | Complete | ChunkerService, LlmProviderInterface, 3 providers, LlmService facade                                                    |
| M3        | Agent Core             | Complete | ReAct agent, RAG endpoints, trust framework, error handling                                                             |
| M4        | Frontend               | Complete | Chat UI, agent steps, source cards, trust bar, provider selector, landing page                                          |
| M5        | Voice Output           | Complete | TTS backend + frontend audio player (ElevenLabs originally, now Mistral Voxtral, ADR-008)                               |
| M6        | Eval Harness           | Complete | 27-query eval suite, 5 evaluators, LangSmith integration, CLI runner                                                    |
| M7        | Deploy & Observability | ~87%     | Dockerfile, docker-compose, Render deploy, CORS fixes, Pino logging, Sentry                                             |
| M8        | Multi-Agent Pipeline   | Complete | LangGraph pipeline (Retriever/Synthesizer/Writer), per-stage retry, SSE resilience                                      |
| --        | Pipeline latency       | Complete | ADR-009: code-attached sources, Retriever output cap, recursion-limit salvage, level-by-level comment fetch, eval stats |
| --        | Post-M8 improvements   | Complete | Fail-fast on bad keys + `GET /api/health/llm`, narration fix, streaming draft, answer replay, follow-ups, merged writer |

---

## 4. Repository Structure

```
voxpopuli/
+-- apps/
|   +-- api/
|   |   +-- src/
|   |       +-- main.ts                  # Bootstrap: /api prefix, helmet, CORS, ValidationPipe, HttpExceptionFilter
|   |       +-- instrument.ts            # Sentry init (enabled only when SENTRY_DSN is set)
|   |       +-- app/                     # AppModule, AppController, AppService
|   |       +-- agent/                   # AgentModule, AgentService, OrchestratorService, pipeline nodes
|   |       |   +-- agent.service.ts          # Legacy ReAct loop via LangChain createAgent
|   |       |   +-- agent.module.ts           # NestJS module (imports Hn, Chunker, Llm)
|   |       |   +-- orchestrator.service.ts   # Multi-agent pipeline coordinator (LangGraph)
|   |       |   +-- pipeline-graph.ts         # StateGraph builder, withRetry, withWriterFallback
|   |       |   +-- tools.ts                  # search_hn, get_story, get_comments + SourceRegistry
|   |       |   +-- system-prompt.ts          # Legacy agent system prompt with claim taxonomy
|   |       |   +-- trust.ts                  # computeTrustMetadata (pure function)
|   |       |   +-- partial-response.ts       # buildPartialResponse (graceful degradation)
|   |       |   +-- fallback-response.ts      # buildFallbackResponse (Writer failure fallback)
|   |       |   +-- *.spec.ts                 # agent.service, orchestrator.service, pipeline-graph, tools,
|   |       |   |                             # trust, partial-response, fallback-response
|   |       |   +-- nodes/                    # Pipeline stage implementations
|   |       |   |   +-- retriever.node.ts     # ReAct collection + compaction -> EvidenceBundle
|   |       |   |   +-- compaction-parse.ts   # parseCompactedThemes: lenient theme parsing + salvage
|   |       |   |   +-- synthesizer.node.ts   # EvidenceBundle -> AnalysisResult (+ merged-mode node)
|   |       |   |   +-- writer.node.ts        # AnalysisResult -> AgentResponseV2 (streams a draft)
|   |       |   |   +-- writer-draft.ts       # renderAnswerMarkdown, WriterDraftStreamer, endsMidEscape
|   |       |   |   +-- parse-llm-json.ts     # cleanLlmOutput (strip fences before JSON.parse)
|   |       |   |   +-- *.spec.ts             # retriever, compaction-parse, synthesizer, writer, writer-draft
|   |       |   +-- prompts/                  # Pipeline stage system prompts
|   |       |       +-- retriever.prompt.ts   # ReAct collection strategy
|   |       |       +-- compactor.prompt.ts   # Raw data -> themes (sources are attached by code)
|   |       |       +-- synthesizer.prompt.ts # Bundle -> insights + contradictions
|   |       |       +-- writer.prompt.ts      # Analysis -> editorial prose
|   |       |       +-- merged-writer.prompt.ts # Evidence -> prose in one call (PIPELINE_MERGED_WRITER)
|   |       +-- cache/               # CacheModule (global): CacheService, QueryStore (+ specs)
|   |       +-- chunker/             # ChunkerModule, ChunkerService, chunker.service.spec.ts
|   |       +-- config/              # env.validation.ts (class-validator schema), cors.ts (+ spec)
|   |       +-- health/              # HealthModule, HealthController, health.controller.spec.ts
|   |       +-- hn/                  # HnModule, HnService, HnController, hn.service.spec.ts
|   |       +-- llm/                 # LlmModule, LlmService, llm-provider.interface.ts (+ ModelOptions)
|   |       |   +-- model-ids.ts          # Central registry of model IDs and API base URLs
|   |       |   +-- llm-errors.ts         # isAuthError, LlmAuthError, failFastOnClientError, PROVIDER_KEY_ENV
|   |       |   +-- invoke-with-retry.ts  # TPM-error retry that truncates the largest message
|   |       |   +-- providers/       # openrouter.provider.ts, claude.provider.ts, mistral.provider.ts, index.ts
|   |       |   +-- *.spec.ts             # llm.service, llm-errors, invoke-with-retry
|   |       +-- rag/                 # RagModule, RagController, rate limiting, input validation
|   |       |   +-- rag.controller.ts         # POST /query, GET /stream (SSE), GET /query/:id/result
|   |       |   +-- rag.controller.spec.ts
|   |       |   +-- rag.module.ts             # NestJS module (imports AgentModule)
|   |       |   +-- dto/                      # RagQueryDto (class-validator)
|   |       |   +-- filters/                  # HttpExceptionFilter (global error handler) + spec
|   |       +-- tts/                 # TtsModule, TtsController, TtsService (Mistral Voxtral)
|   |           +-- mp3-xing.ts               # addXingHeader: VBR header so players report duration
|   |           +-- prompts/narrator.prompt.ts # Podcast rewrite prompt, MAX_NARRATION_CHARS (2500)
|   |           +-- *.spec.ts                 # tts.controller, tts.service, mp3-xing
|   +-- api-e2e/                     # E2E test harness (api.spec.ts)
|   +-- web/                         # Angular frontend
|   |   +-- src/app/
|   |       +-- app.ts / app.html / app.css   # Root component (router outlet)
|   |       +-- app.routes.ts         # '' -> ChatComponent, 'design-system' -> DesignSystemPage (lazy)
|   |       +-- app.config.ts         # Application providers
|   |       +-- components/
|   |       |   +-- chat/             # ChatComponent -- landing page, query input, streaming, draft, follow-ups
|   |       |   +-- agent-steps/      # AgentStepsComponent -- pipeline stages + research timeline
|   |       |   +-- audio-player/     # AudioPlayerComponent -- narration playback (iOS gesture unlock)
|   |       |   +-- source-card/      # SourceCardComponent -- HN story card with metadata
|   |       |   +-- trust-bar/        # TrustBarComponent -- visual trust indicators
|   |       |   +-- provider-selector/ # ProviderSelectorComponent -- LLM provider chips
|   |       |   +-- meta-bar/         # MetaBarComponent -- token count, duration, provider info
|   |       +-- pages/
|   |       |   +-- design-system/    # Design system showcase page
|   |       +-- services/
|   |           +-- rag.service.ts    # HTTP + SSE client for RAG endpoints (legacy + pipeline)
|   |           +-- tts.service.ts    # POST /api/tts/narrate client
|   +-- web-e2e/                     # Frontend E2E placeholder
+-- libs/
|   +-- shared-types/src/lib/        # API contracts, trust framework, pipeline types
|       +-- shared-types.ts          # Core types (AgentResponse, RagQuery, trust, HN data, health, QueryResult)
|       +-- evidence.types.ts        # EvidenceBundle, EvidenceItem, ThemeGroup, SourceMetadata
|       +-- analysis.types.ts        # AnalysisResult, Insight, Contradiction
|       +-- response-v2.types.ts     # AgentResponseV2, ResponseSection
|       +-- pipeline.types.ts        # PipelineConfig, PipelineEvent, PipelineResult, PipelineState, PriorEvidence
|       +-- *.spec.ts                # Zod schema validation tests (evidence, analysis)
+-- evals/                           # Eval harness (M6)
|   +-- queries.json                 # 27 test queries (20 general + 7 trust-specific)
|   +-- run-eval.ts                  # CLI entry point (commander)
|   +-- stream-client.ts             # SSE client: parseSseChunk, runQueryStream (pipeline default)
|   +-- latency-stats.ts             # percentile, summarizeLatency, printLatencyDiff (--baseline)
|   +-- evaluators/                  # source-accuracy, quality-judge, efficiency, latency, cost
|   +-- dataset.ts                   # LangSmith dataset sync helper
|   +-- score.ts                     # Score aggregation and reporting
|   +-- feedback.ts                  # Post eval scores to LangSmith as run feedback
|   +-- types.ts                     # EvalQuery, EvalRunResult, EvalScore, EvalReport
|   +-- README.md / LESSONS.md       # Harness usage and lessons learned
|   +-- __tests__/                   # score, latency-stats, stream-client tests
|   +-- evaluators/__tests__/        # Evaluator tests
|   +-- results/                     # Eval run output JSON files (gitignored)
+-- docs/
|   +-- adr/                         # ADR-002 through ADR-010
|   +-- adrs/                        # ADR-001
|   +-- plans/                       # Design documents and implementation plans
|   +-- screenshots/                 # UI flow screenshots
|   +-- architecture.md              # Technical architecture and milestone breakdown
|   +-- product.md                   # Product specification
|   +-- design-system.md             # Data Noir Editorial design system
|   +-- codebase-summary.md          # This file
+-- scripts/set-api-url.sh           # Build-time API URL injection for the web app
+-- .env.example                     # Environment variable template
+-- CHANGELOG.md                     # Release notes
+-- Dockerfile                       # Container build
+-- docker-compose.yml               # Local container orchestration
+-- render.yaml                      # Render deploy blueprint
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

| Attribute    | Value                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Purpose      | In-memory LRU cache wrapping `lru-cache`, plus the per-query result store                            |
| Scope        | `@Global()` -- `CacheService` and `QueryStore` available to all modules without explicit import      |
| Key classes  | `CacheService`, `QueryStore`                                                                         |
| Key methods  | `getOrSet<T>(key, fetcher, ttl)`, `get<T>(key)`, `set<T>(key, value, ttl)`, `del(key)`, `getStats()` |
| Test files   | `cache.service.spec.ts`, `query-store.spec.ts`                                                       |
| Dependencies | `lru-cache`, `@voxpopuli/shared-types` (CacheStats, QueryResult, PriorEvidence)                      |

**QueryStore** tracks each streamed query by `queryId` (UUID v4): `create()`, `appendEvent()`, `appendStep()`, `complete()`, `fail()`, `get()`, `findRunning()`, `findReusable()`, `setEvidence()`, `getEvidence()`.

| TTL             | Value  | Purpose                                                                  |
| --------------- | ------ | ------------------------------------------------------------------------ |
| `QUERY_TTL`     | 300 s  | Running/failed query entries                                             |
| `COMPLETED_TTL` | 900 s  | Completed answers are replayed to identical questions (`findReusable()`) |
| `EVIDENCE_TTL`  | 1800 s | A finished run's `PriorEvidence`, available for follow-up questions      |

The dedup key normalizes case and whitespace and includes the mode: `<provider>:pipeline`, `<provider>:legacy`, or `<provider>:pipeline:followup:<parentId>`. A running match is attached to; a completed match is replayed immediately with `meta.cached: true`. Failed queries are never reused.

### 5.2 HealthModule (`apps/api/src/health/`)

| Attribute    | Value                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose      | Health-check endpoints for load balancers, status indicators, and operators                                                                                                                                                          |
| Key class    | `HealthController`                                                                                                                                                                                                                   |
| Key methods  | `GET /api/health` returns `HealthResponse` (status, uptime, cacheStats from `CacheService`) plus `memoryMB`; `GET /api/health/llm` returns `LlmHealthResponse` from a 1-token call to the active provider, cached 60 s, 15 s timeout |
| Failure mode | `GET /api/health/llm` responds 503 with `error: 'auth'` (key rejected) or `error: 'unavailable'` (anything else) and a one-line `detail`                                                                                             |
| Test file    | `health.controller.spec.ts`                                                                                                                                                                                                          |
| Dependencies | `CacheService`, `LlmService` (imports `LlmModule`), `isAuthError` from `llm-errors.ts`, `@voxpopuli/shared-types`                                                                                                                    |

### 5.3 HnModule (`apps/api/src/hn/`)

| Attribute    | Value                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Purpose      | Hacker News data retrieval from Algolia (search) and Firebase (items, comment trees)                                               |
| Key class    | `HnService`                                                                                                                        |
| Key methods  | `search(query, options)`, `searchByDate(query, options)`, `getItem(id)`, `getCommentTree(storyId, maxDepth)`                       |
| Controller   | `HnController` -- test endpoints (`/api/hn/search`, `/api/hn/item/:id`, `/api/hn/comments/:storyId`)                               |
| Test file    | `hn.service.spec.ts`                                                                                                               |
| Dependencies | `@nestjs/axios` (HttpModule), `CacheService`, `@voxpopuli/shared-types`                                                            |
| Cache TTLs   | Search: 900s (15 min), Story: 3600s (1 hr), Comment: 1800s (30 min)                                                                |
| Constraints  | 30 comment cap, 15 top-level max, 3 replies per comment, max depth 3                                                               |
| Comment tree | Fetched one depth level at a time, with every parent's replies at that level requested in parallel (ADR-009); dead/deleted skipped |
| Retry logic  | `retryWithBackoff()` -- 3 attempts, exponential backoff with jitter, retries on 5xx/network errors only                            |

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

| Attribute    | Value                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Purpose      | LLM provider facade with lazy instantiation and provider switching                                                   |
| Key class    | `LlmService`                                                                                                         |
| Key methods  | `getModel(providerOverride?, options?: ModelOptions)`, `getMaxContextTokens(providerOverride?)`, `getProviderName()` |
| Test files   | `llm.service.spec.ts`, `llm-errors.spec.ts`, `invoke-with-retry.spec.ts`                                             |
| Dependencies | `ConfigService`, all three provider classes                                                                          |

**Providers** (model IDs live in `model-ids.ts`):

| Provider   | Class                | LangChain Model                                        | Model ID                                                   | Context Window |
| ---------- | -------------------- | ------------------------------------------------------ | ---------------------------------------------------------- | -------------- |
| Mistral    | `MistralProvider`    | `FailFastChatMistralAI` (extends `ChatMistralAI`)      | `mistral-small-latest`                                     | 262,000 tokens |
| Claude     | `ClaudeProvider`     | `ChatAnthropic`                                        | `claude-haiku-4-5-20251001`                                | 200,000 tokens |
| OpenRouter | `OpenRouterProvider` | `ChatOpenAI` (base URL `https://openrouter.ai/api/v1`) | `qwen/qwen3-235b-a22b-2507` (override: `OPENROUTER_MODEL`) | 128,000 tokens |

All providers implement `LlmProviderInterface` with three members: `name`, `maxContextTokens`, and `getModel(options?: ModelOptions)`. `ModelOptions.maxTokens` caps generated tokens for call sites whose useful output is small (the Retriever's ReAct turns use 768; the LLM health probe uses 5). Each provider wraps a LangChain `BaseChatModel` instance that is lazily created. `groq` is accepted as a deprecated alias for `openrouter`.

**Error handling (`llm-errors.ts`):**

| Export                  | Purpose                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `isAuthError()`         | True when a call failed because the provider rejected the credentials (`status`/`statusCode` 401/403, or auth phrases in the message) |
| `LlmAuthError`          | Error whose message names the env var to fix (via `PROVIDER_KEY_ENV`)                                                                 |
| `failFastOnClientError` | Retry policy: auth errors, aborts, and 4xx other than 408/429 stop retries immediately                                                |
| `PROVIDER_KEY_ENV`      | Provider -> API key env var map                                                                                                       |

`FailFastChatMistralAI` exists because the Mistral SDK reports HTTP codes as `statusCode`, which LangChain's retry logic ignored, so a rejected key was retried for about 2 minutes before the user saw an error.

**Shared utility:** `invoke-with-retry.ts` exports `invokeWithRetry()` and `isTpmError()`. On a Groq-style tokens-per-minute / request-too-large error it halves the longest message and retries; other errors are rethrown.

### 5.6 AgentModule (`apps/api/src/agent/`)

| Attribute       | Value                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose         | ReAct reasoning agent and multi-agent pipeline for HN search and synthesis                                                                                                                          |
| Key classes     | `AgentService` (legacy ReAct), `OrchestratorService` (multi-agent pipeline)                                                                                                                         |
| Test files      | `agent.service.spec.ts`, `orchestrator.service.spec.ts`, `pipeline-graph.spec.ts`, `tools.spec.ts`, `trust.spec.ts`, `partial-response.spec.ts`, `fallback-response.spec.ts`, `nodes/*.spec.ts` (5) |
| Dependencies    | `LlmService`, `HnService`, `ChunkerService`, `ConfigService` (optional), `langchain` (createAgent), `@langchain/langgraph`, `zod`                                                                   |
| Agent framework | LangChain `createAgent` (v1.2+) with `tool()` helper and Zod schemas                                                                                                                                |
| Constraints     | Legacy agent: max 7 steps (`recursionLimit`) with action count guard, 180s timeout (`AbortSignal`), 5 concurrent runs (counter semaphore)                                                           |
| Feature flag    | Pipeline activated via `useMultiAgent` query param on SSE endpoint; frontend always sends `true`, making pipeline the default. `PIPELINE_MERGED_WRITER=true` enables merged-writer mode             |

**Tools** (defined in `tools.ts`):

| Tool           | Wraps                           | Returns                                                                                                                                                            |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `search_hn`    | `HnService.search/searchByDate` | Chunked story metadata via ChunkerService. If a `min_points` search returns fewer than 3 hits (`MIN_FILTERED_HITS`), it retries without the filter and adds a note |
| `get_story`    | `HnService.getItem`             | Formatted story details with posted date                                                                                                                           |
| `get_comments` | `HnService.getCommentTree`      | Chunked comment tree via ChunkerService                                                                                                                            |

`search_hn` and `get_story` record each story they surface (`SourceMetadata`, including `postedDate` from the HN API) into a per-request `SourceRegistry`. The Retriever builds the bundle's source table from the registry, so the LLM never writes source metadata.

**OrchestratorService** (multi-agent pipeline):

| Attribute  | Value                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose    | LangGraph StateGraph pipeline: Retriever -> Synthesizer -> Writer producing structured editorial responses                                                                                                                                                                                                                                                         |
| Methods    | `runWithFallback(query, config, prior?)` (used by `RagController`), `runStream(query, config, prior?)`                                                                                                                                                                                                                                                             |
| Stages     | `retriever` (ReAct + compaction), `synthesizer` (evidence analysis), `writer` (editorial prose)                                                                                                                                                                                                                                                                    |
| Config     | `PipelineConfig` -- per-stage provider mapping, token budgets, 30s default timeout                                                                                                                                                                                                                                                                                 |
| Recovery   | Synthesizer retries once; Writer retries once (without graph config, so no duplicate draft) then falls back to `buildFallbackResponse()`. On a Retriever/Synthesizer failure, `runWithFallback()` marks only incomplete stages as errored and runs the legacy `AgentService` on the user's chosen provider. Auth errors skip the fallback and throw `LlmAuthError` |
| Follow-ups | When `prior` (`PriorEvidence`) is passed, the Retriever is replaced by a node that returns the stored evidence bundle and steps                                                                                                                                                                                                                                    |
| Stream     | Yields `pipeline` events at stage transitions, `step` events from the inner ReAct loop, `token` events from Writer draft deltas, then `complete` (with `evidence` for later follow-ups)                                                                                                                                                                            |

**Pipeline nodes** (`nodes/`):

| File                  | Input -> Output                       | Key behavior                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retriever.node.ts`   | query -> `EvidenceBundle`             | Runs a ReAct agent (output-capped model) to collect HN data, then compacts via LLM. A `GraphRecursionError` compacts what was collected instead of failing. Dry-well check skips compaction on sparse data. `summarizeToolOutput()` counts comments from `[Story <id>]` lines for the timeline |
| `compaction-parse.ts` | compactor text -> themes              | `parseCompactedThemes()`: unknown evidence type -> opinion, relevance clamped, at most 6 themes, salvages themes before a JSON syntax error                                                                                                                                                    |
| `synthesizer.node.ts` | `EvidenceBundle` -> `AnalysisResult`  | Extracts insights, contradictions, confidence, gaps. `applyEvidenceFloor()`: under 3 sources caps confidence (<=1 -> low, 2 -> medium) and adds a gap. `createMergedSynthesizerNode()` builds the analysis without an LLM (`analysisFromThemes()`)                                             |
| `writer.node.ts`      | `AnalysisResult` -> `AgentResponseV2` | Produces editorial prose with sections and citations; streams its first attempt as `writer_draft` custom events. `fromEvidence` mode uses `MERGED_WRITER_SYSTEM_PROMPT` and writes from the bundle                                                                                             |
| `writer-draft.ts`     | partial JSON -> markdown deltas       | `WriterDraftStreamer` turns the Writer's partial JSON into append-only markdown; `renderAnswerMarkdown()` renders the final answer; `endsMidEscape()` guards partial escapes                                                                                                                   |
| `parse-llm-json.ts`   | LLM text -> clean JSON text           | `cleanLlmOutput()` strips markdown fences; node-level repair retries ask for the complete object                                                                                                                                                                                               |

**Supporting files:**

| File                   | Purpose                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pipeline-graph.ts`    | `buildPipelineGraph()`, `PipelineAnnotation`, `withRetry()`, `withWriterFallback()` (swallowed errors are logged) |
| `system-prompt.ts`     | Agent role, search strategy, claim taxonomy (evidence/consensus/anecdote/opinion), honesty rules                  |
| `trust.ts`             | `computeTrustMetadata()` -- source verification, recency, viewpoint diversity, Show HN detection, honesty flags   |
| `partial-response.ts`  | `buildPartialResponse()` -- returns collected data when LLM fails mid-loop                                        |
| `fallback-response.ts` | `buildFallbackResponse()` -- constructs response from AnalysisResult when Writer fails                            |
| `prompts/*.prompt.ts`  | System prompts for retriever, compactor, synthesizer, writer, and merged writer                                   |

### 5.7 RagModule (`apps/api/src/rag/`)

| Attribute    | Value                                                                             |
| ------------ | --------------------------------------------------------------------------------- |
| Purpose      | HTTP API layer for RAG queries with caching, rate limiting, and structured errors |
| Key class    | `RagController`                                                                   |
| Test files   | `rag.controller.spec.ts`, `filters/http-exception.filter.spec.ts`                 |
| Dependencies | `AgentService`, `OrchestratorService`, `CacheService`, `QueryStore`               |

**Endpoints:**

| Endpoint                    | Method | Description                                                                                                                                                                                                |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/rag/query`            | POST   | Blocking full `AgentResponse`, cached 10 min (key includes `useMultiAgent`)                                                                                                                                |
| `/api/rag/stream`           | GET    | SSE streaming. Query params: `query` (required, max 500 chars), `provider`, `useMultiAgent`, `followUpOf=<queryId>` (pipeline only: reuse that run's stored evidence)                                      |
| `/api/rag/query/:id/result` | GET    | Returns stored query result by queryId. 200 with full `QueryResult` when complete or errored, 202 with full `QueryResult` shape (status `running`) when the agent is still in progress, 404 when not found |

**Supporting files:**

| File                               | Purpose                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `dto/rag-query.dto.ts`             | Input validation: query (required, max 500 chars), maxSteps (1-7), provider, useMultiAgent |
| `filters/http-exception.filter.ts` | Global exception filter: 400/429/502/500 mapping, structured JSON error body, logging      |

**Rate limiting:** Global 60 req/min via timestamp array (no per-IP tracking, no external dependency).

**SSE model:** Every stream starts with an `init` event carrying the `queryId`, sends `ping` heartbeats every 10s, and sets a 5s `retry` directive. Legacy mode streams `thought`/`action`/`observation`/`answer` events from `AgentService.runStream()`. Pipeline mode (`useMultiAgent=true`) emits `pipeline` events at stage transitions alongside `thought`/`action`/`observation` events from the Retriever's inner ReAct loop, `token` events carrying append-only markdown deltas of the Writer's draft, and a final `answer` that replaces the draft. Identical in-flight or recently completed queries are served from `QueryStore` instead of starting a new run. Frontend `RagService` includes retry logic, heartbeat detection, visibility-aware reconnection for mobile resilience, and a stall-detection watchdog (300s timeout, checked every 5s while the page is visible). The `ChatComponent` supports explicit query cancellation (tearing down the SSE subscription and resetting UI state while preserving any partially received content). SSE event handling is centralized in the `handleStreamEvent()` method, which is shared by the initial `submit()` flow, `submitFollowUp()`, and the `reconnectStream()` recovery path. Background tab handling uses a fetch-on-return strategy: `handleVisibilityChange()` kills the stale SSE connection when the page becomes visible again, fetches the stored result by queryId, and if the agent is still running reconnects the SSE stream via `reconnectStream()`.

### 5.8 TtsModule (`apps/api/src/tts/`)

| Attribute    | Value                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose      | Podcast-style narration of answers via Mistral Voxtral (ADR-008)                                                                                                       |
| Key classes  | `TtsController`, `TtsService`                                                                                                                                          |
| Endpoints    | `POST /api/tts/narrate` (body `TtsRequest`, returns `audio/mpeg` with `Content-Length` and `X-TTS-Characters`); `GET /api/tts/voices` (returns `VoiceConfig`)          |
| Key methods  | `narrate(text, { rewrite, voiceId })`, `rewriteForSpeech(text)` (separate single-turn LLM call), `synthesize(script, voice?)`                                          |
| Limits       | Input max 10,000 chars, narration script capped at 2,500 chars (`MAX_NARRATION_CHARS`), 60 req/min, 60s upstream timeout, `voiceId` must match `^[A-Za-z0-9_-]{1,64}$` |
| MP3 fix      | `mp3-xing.ts` `addXingHeader()` adds a Xing/VBR header so players (notably iOS Safari) report the right duration                                                       |
| Test files   | `tts.controller.spec.ts`, `tts.service.spec.ts`, `mp3-xing.spec.ts`                                                                                                    |
| Dependencies | `LlmService` (imports `LlmModule`), `ConfigService` (`MISTRAL_API_KEY`, `MISTRAL_TTS_MODEL`, `MISTRAL_TTS_VOICE`)                                                      |

### 5.9 ConfigModule (`apps/api/src/config/`)

| Attribute          | Value                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose            | Environment variable validation at application startup; CORS origin parsing                                                                                   |
| Key exports        | `validate()` function used by `ConfigModule.forRoot()`; `resolveCorsOrigin()` in `cors.ts`                                                                    |
| Validation library | `class-validator` + `class-transformer`                                                                                                                       |
| Key class          | `EnvironmentVariables` with decorated fields                                                                                                                  |
| Validated vars     | `LLM_PROVIDER` (required), `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_TTS_MODEL`, `MISTRAL_TTS_VOICE`, `PORT` |
| Test file          | `cors.spec.ts`                                                                                                                                                |

### 5.10 AppModule (`apps/api/src/app/`)

| Attribute | Value                                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose   | Root NestJS module wiring all feature modules together                                                                                                                                                     |
| Imports   | `SentryModule`, `ConfigModule` (global), `LoggerModule` (pino), `CacheModule`, `HealthModule`, `HnModule`, `ChunkerModule`, `LlmModule`, `AgentModule`, `RagModule`, `TtsModule`                           |
| Bootstrap | `main.ts` imports `instrument.ts` (Sentry), configures global prefix (`/api`), helmet CSP, CORS from `FRONTEND_URL`, graceful shutdown, Pino logger, global `ValidationPipe`, global `HttpExceptionFilter` |

### 5.11 Web app (`apps/web/src/app/`)

| Piece                       | Notes                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatComponent`             | Landing page and results page. Streams via `RagService.stream()`, shows a "Drafting answer..." card (`data-testid="answer-draft"`) from `token` events, an "Ask a follow-up" box (`data-testid="follow-up"`) after an answer, cancel/retry, theme toggle |
| `AgentStepsComponent`       | Pipeline stage rows with a live timer capped at 180s (`MAX_STAGE_ELAPSED_MS`), research timeline that counts comments per story                                                                                                                          |
| `AudioPlayerComponent`      | Narration player (play/pause, seek, speed, download); unlocks the audio element during the tap so iOS Safari can play the narration when it arrives                                                                                                      |
| `ProviderSelectorComponent` | Chips for `openrouter` (Qwen3), `mistral`, `claude`; `model()` signal defaults to `mistral`                                                                                                                                                              |
| `RagService`                | `query()`, `fetchResult(queryId)`, `stream(query, provider?, useMultiAgent?, followUpOf?)`; 300s stall watchdog                                                                                                                                          |
| `TtsService`                | `narrate(text, rewrite = true)`                                                                                                                                                                                                                          |

---

## 6. Shared Types

All types are exported from `@voxpopuli/shared-types`. Core interfaces live in `shared-types.ts`; pipeline types are split across `evidence.types.ts`, `analysis.types.ts`, `response-v2.types.ts`, and `pipeline.types.ts`.

### Core Query/Response

| Interface       | Purpose                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `RagQuery`      | Inbound query shape: `query`, `maxSteps?`, `includeComments?`, `provider?`                    |
| `AgentResponse` | Top-level response: `answer`, `steps[]`, `sources[]`, `trust`, `meta`                         |
| `AgentStep`     | Single reasoning step: type (`thought`/`action`/`observation`), content, tool info, timestamp |
| `AgentSource`   | Referenced HN story: storyId, title, url, author, points, commentCount, postedDate?           |
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

| Interface     | Purpose                                                       |
| ------------- | ------------------------------------------------------------- |
| `TtsRequest`  | Narration request: text, rewrite flag, voiceId                |
| `VoiceConfig` | Active narration voice: id (preset slug or UUID), name, model |

### Pipeline: Evidence (`evidence.types.ts`)

| Interface        | Purpose                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `SourceMetadata` | HN story metadata for source tracking: storyId, title, url, author, points, commentCount, postedDate? (YYYY-MM-DD, from the HN API) |
| `EvidenceItem`   | Single evidence piece: sourceId, text, type (evidence/anecdote/opinion/consensus), relevance score (0-1)                            |
| `ThemeGroup`     | Thematic grouping of evidence items: label, items[] (min 1)                                                                         |
| `EvidenceBundle` | Compacted output from Retriever: query, themes[] (1-6), allSources[], totalSourcesScanned, tokenCount                               |

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

| Interface        | Purpose                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `PipelineStage`  | Stage enum: `retriever`, `synthesizer`, `writer`                                                         |
| `StageStatus`    | Status enum: `started`, `progress`, `done`, `error`                                                      |
| `PipelineEvent`  | SSE event at stage transitions: stage, status, detail, elapsed                                           |
| `PipelineConfig` | Config: useMultiAgent flag, per-stage providerMap, tokenBudgets, timeout (default 30s)                   |
| `PriorEvidence`  | Evidence kept from a completed run for follow-ups: query, bundle, steps (plain interface, no Zod schema) |
| `PipelineResult` | Full result: response, bundle, analysis, events[], durationMs                                            |
| `PipelineState`  | LangGraph accumulator: query, bundle?, analysis?, response?, events[], error?                            |

All pipeline types except `PriorEvidence` use Zod schemas with runtime validation and inferred TypeScript types.

### Operational

| Interface             | Purpose                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CacheStats`          | Cache metrics: hits, misses, keys                                                                                |
| `HealthResponse`      | Health endpoint response: status, uptime, cacheStats                                                             |
| `LlmHealthResponse`   | `GET /api/health/llm` response: provider, ok, latencyMs, error? (`'auth'` / `'unavailable'`), detail?            |
| `StoredPipelineEvent` | Pipeline event as stored in `QueryStore`: stage, status, detail, elapsed                                         |
| `QueryResult`         | Stored query: queryId, status (`running`/`complete`/`error`), response, pipelineEvents, steps, error, timestamps |

---

## 7. Configuration

### Environment Variables

| Variable                 | Required                 | Default                     | Purpose                                                                                                                                                                            |
| ------------------------ | ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`           | Yes                      | `mistral`                   | Active LLM provider (`openrouter`, `claude`, or `mistral`). Note: the frontend provider selector defaults to `mistral`, which overrides this server-side default for SSE requests. |
| `OPENROUTER_API_KEY`     | When provider=openrouter | --                          | OpenRouter API authentication                                                                                                                                                      |
| `OPENROUTER_MODEL`       | No                       | `qwen/qwen3-235b-a22b-2507` | OpenRouter model slug override                                                                                                                                                     |
| `MISTRAL_API_KEY`        | When provider=mistral    | --                          | Mistral API authentication; also used for Voxtral TTS                                                                                                                              |
| `ANTHROPIC_API_KEY`      | When provider=claude     | --                          | Anthropic API authentication                                                                                                                                                       |
| `PIPELINE_MERGED_WRITER` | No                       | `false`                     | `true` skips the Synthesizer's LLM call and lets the Writer analyze the evidence directly (ADR-010)                                                                                |
| `MISTRAL_TTS_MODEL`      | No                       | `voxtral-mini-tts-latest`   | Voxtral TTS model for narration (uses `MISTRAL_API_KEY`)                                                                                                                           |
| `MISTRAL_TTS_VOICE`      | No                       | `en_paul_neutral`           | Narrator voice: Voxtral preset slug or custom voice UUID                                                                                                                           |
| `PORT`                   | No                       | `3000`                      | HTTP server port                                                                                                                                                                   |
| `LOG_LEVEL`              | No                       | `info`                      | Pino log level                                                                                                                                                                     |
| `NODE_ENV`               | No                       | `development`               | Enables pretty-printed logs and disables Sentry event sending in non-production                                                                                                    |
| `FRONTEND_URL`           | No                       | `http://localhost:4200`     | CORS origin(s): comma-separated list, or `onrender.com` for any Render subdomain                                                                                                   |
| `SENTRY_DSN`             | No                       | --                          | Enables Sentry error tracking when set                                                                                                                                             |
| `LANGSMITH_API_KEY`      | No                       | --                          | LangSmith tracing and eval dataset sync                                                                                                                                            |
| `LANGSMITH_TRACING`      | No                       | --                          | `true` enables LangChain tracing to LangSmith                                                                                                                                      |
| `LANGSMITH_PROJECT`      | No                       | `voxpopuli-evals`           | LangSmith project for eval feedback                                                                                                                                                |
| `EVAL_API_URL`           | No                       | `http://localhost:3000`     | API base URL used by the eval harness                                                                                                                                              |

`.env.example` also lists `EVAL_JUDGE_PROVIDER` and `USE_MULTI_AGENT`, but no code currently reads either: the LLM judge calls Mistral directly with `MISTRAL_API_KEY`, and pipeline mode is selected per request by the `useMultiAgent` query param.

### Validation

Environment variables are validated at startup using `class-validator` in `apps/api/src/config/env.validation.ts`. The `validate()` function is passed to `ConfigModule.forRoot()` in `AppModule`. Invalid configuration causes the application to fail fast with a descriptive error. A missing key for the selected provider throws when that provider is first used; a rejected key surfaces as `LlmAuthError` and on `GET /api/health/llm`.

---

## 8. Architecture Decision Records

ADR-001 lives in `docs/adrs/001-ci-cd-and-quality-gates.md`; ADR-002 onward live in `docs/adr/`.

| ADR     | Title                                                    | Date       | Summary                                                                                                                   |
| ------- | -------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 | CI/CD Pipeline and Quality Gates                         | 2026-04-03 | Defines GitHub Actions CI pipeline and pre-commit hook strategy for lint/test quality gates                               |
| ADR-002 | Chunker Strategy and Token Budget Design                 | 2026-04-04 | Character-based token estimation (1 token ~ 4 chars), 4-phase priority budget allocation, HTML-to-markdown conversion     |
| ADR-003 | LLM Provider Architecture and Tool Protocol Design       | 2026-04-04 | LangChain-based provider interface with facade pattern, lazy instantiation, and native tool-calling protocol per provider |
| ADR-004 | ReAct Agent Design and Tool Selection Strategy           | 2026-04-04 | LangChain `createAgent` (v1.2+), 3-tool design, chunked string output, safety constraints, SSE streaming integration      |
| ADR-005 | True Mid-Loop SSE Streaming via AsyncGenerator           | 2026-04-05 | AsyncGenerator-based mid-loop SSE streaming for real-time agent step visualization                                        |
| ADR-006 | Adaptive Query Decomposition in the Retriever Prompt     | 2026-04-11 | Query-type-aware search strategies in Retriever prompt, extending ADR-004                                                 |
| ADR-007 | Query-ID Resilience -- Decouple Result Delivery from SSE | 2026-04-14 | `queryId` on the first SSE event, stored results fetchable after a dropped stream, query deduplication                    |
| ADR-008 | Mistral Voxtral for Text-to-Speech                       | 2026-09-27 | Replace ElevenLabs with Voxtral narration on the existing Mistral key                                                     |
| ADR-009 | Cutting Pipeline Latency by Generating Less              | 2026-09-27 | Code attaches sources instead of the LLM, Retriever output cap, recursion-limit salvage, faster comment fetching          |
| ADR-010 | Merged Writer Mode and Model Throughput                  | 2026-10-03 | Opt-in `PIPELINE_MERGED_WRITER` skips the Synthesizer's LLM call; ships off by default, model choice left to the operator |

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
| M5: Voice Output Design             | 2026-04-13 | TTS backend and audio player design                                                    |
| M5: Voice Output Plan               | 2026-04-13 | TTS implementation plan                                                                |
| Query-ID Resilience Design          | 2026-04-14 | Result store and reconnect-by-queryId design                                           |

---

## 9. Test Summary

Per-file counts below are `it(` / `it.each(` / `test(` occurrences from grep. `it.each` cases expand at run time, so runner totals can be higher (the API runner reports 404 tests against 392 static `it` calls).

### API Tests (Jest via Nx)

| Test Suite          | File                                        | Tests | Covers                                                                                     |
| ------------------- | ------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| AgentService        | `agent/agent.service.spec.ts`               | 10    | Agent execution, concurrency limits, semaphore cleanup, prompt template, source extraction |
| OrchestratorService | `agent/orchestrator.service.spec.ts`        | 21    | Pipeline execution, stage transitions, fallback, auth fail-fast, follow-ups, merged mode   |
| PipelineGraph       | `agent/pipeline-graph.spec.ts`              | 9     | Graph wiring, `withRetry`, `withWriterFallback`                                            |
| Tools               | `agent/tools.spec.ts`                       | 27    | Tool factories, thin-result retry under a points filter, source registry                   |
| Trust               | `agent/trust.spec.ts`                       | 23    | Source verification, recency, viewpoint diversity, Show HN count, honesty flags            |
| PartialResponse     | `agent/partial-response.spec.ts`            | 16    | Graceful degradation when the LLM fails mid-loop                                           |
| FallbackResponse    | `agent/fallback-response.spec.ts`           | 8     | Writer fallback construction from AnalysisResult                                           |
| RetrieverNode       | `agent/nodes/retriever.node.spec.ts`        | 25    | ReAct collection, compaction, dry-well breaker, latency safeguards, `summarizeToolOutput`  |
| CompactionParse     | `agent/nodes/compaction-parse.spec.ts`      | 6     | Lenient theme parsing and salvage                                                          |
| SynthesizerNode     | `agent/nodes/synthesizer.node.spec.ts`      | 16    | Evidence analysis, `applyEvidenceFloor`, merged synthesizer node                           |
| WriterNode          | `agent/nodes/writer.node.spec.ts`           | 15    | Editorial prose, merged (`fromEvidence`) mode, live draft streaming                        |
| WriterDraft         | `agent/nodes/writer-draft.spec.ts`          | 7     | `renderAnswerMarkdown`, `WriterDraftStreamer`, `endsMidEscape` (includes 1 `it.each`)      |
| CacheService        | `cache/cache.service.spec.ts`               | 16    | getOrSet/get/set/del, stats, capacity warning                                              |
| QueryStore          | `cache/query-store.spec.ts`                 | 14    | Query lifecycle, dedup, `findReusable()`                                                   |
| ChunkerService      | `chunker/chunker.service.spec.ts`           | 47    | Token estimation, HTML stripping, story/comment chunking, context assembly, formatting     |
| Cors                | `config/cors.spec.ts`                       | 5     | `resolveCorsOrigin` parsing                                                                |
| HealthController    | `health/health.controller.spec.ts`          | 4     | Health response shape, LLM probe success/auth/unavailable                                  |
| HnService           | `hn/hn.service.spec.ts`                     | 13    | Algolia search, Firebase fetch, comment tree, caching, error handling, retry logic         |
| InvokeWithRetry     | `llm/invoke-with-retry.spec.ts`             | 11    | TPM error detection and truncating retry                                                   |
| LlmErrors           | `llm/llm-errors.spec.ts`                    | 6     | `isAuthError`, `LlmAuthError`, `failFastOnClientError` (includes 2 `it.each`)              |
| LlmService          | `llm/llm.service.spec.ts`                   | 26    | Providers, lazy instantiation, provider override, unknown provider errors                  |
| RagController       | `rag/rag.controller.spec.ts`                | 27    | POST cached/uncached, SSE events, replay, follow-ups, result endpoint, rate limiting       |
| HttpExceptionFilter | `rag/filters/http-exception.filter.spec.ts` | 10    | Status code mapping, error body structure, timestamp, 429/502 handling                     |
| TtsController       | `tts/tts.controller.spec.ts`                | 9     | Narrate validation, voices endpoint, rate limiting                                         |
| TtsService          | `tts/tts.service.spec.ts`                   | 14    | `rewriteForSpeech`, `synthesize`, `narrate`                                                |
| Mp3Xing             | `tts/mp3-xing.spec.ts`                      | 7     | `addXingHeader`                                                                            |

### Shared Types Tests

| Test Suite    | File                                      | Tests | Covers                                                             |
| ------------- | ----------------------------------------- | ----- | ------------------------------------------------------------------ |
| EvidenceTypes | `shared-types/lib/evidence.types.spec.ts` | 7     | Zod schema validation for EvidenceBundle, EvidenceItem, ThemeGroup |
| AnalysisTypes | `shared-types/lib/analysis.types.spec.ts` | 6     | Zod schema validation for AnalysisResult, Insight, Contradiction   |

The `shared-types` project has no `test` target, so these specs are not part of `nx test`.

### Eval Tests (Vitest)

| Test Suite     | File                                                 | Tests | Covers                                                 |
| -------------- | ---------------------------------------------------- | ----- | ------------------------------------------------------ |
| Score          | `evals/__tests__/score.test.ts`                      | 8     | Score aggregation, weighted scoring, report generation |
| LatencyStats   | `evals/__tests__/latency-stats.test.ts`              | 7     | Percentiles, latency summary, baseline diff            |
| StreamClient   | `evals/__tests__/stream-client.test.ts`              | 4     | SSE chunk parsing                                      |
| SourceAccuracy | `evals/evaluators/__tests__/source-accuracy.test.ts` | 5     | Source verification against HN data                    |
| QualityJudge   | `evals/evaluators/__tests__/quality-judge.test.ts`   | 6     | LLM-as-judge scoring with fence stripping              |
| Efficiency     | `evals/evaluators/__tests__/efficiency.test.ts`      | 5     | Tool-call (action step) efficiency scoring             |
| Latency        | `evals/evaluators/__tests__/latency.test.ts`         | 5     | Response time threshold evaluation                     |
| Cost           | `evals/evaluators/__tests__/cost.test.ts`            | 5     | Per-query cost calculation by provider                 |

### Frontend Tests (Vitest via Nx, `@angular/build:unit-test`)

| Test Suite                | File                                                               | Tests | Covers                                                  |
| ------------------------- | ------------------------------------------------------------------ | ----- | ------------------------------------------------------- |
| App                       | `app.spec.ts`                                                      | 1     | Root component renders                                  |
| ChatComponent             | `components/chat/chat.component.spec.ts`                           | 92    | Submit, streaming, draft, follow-ups, cancel, reconnect |
| AgentStepsComponent       | `components/agent-steps/agent-steps.component.spec.ts`             | 57    | Pipeline stages, timers, timeline grouping              |
| AudioPlayerComponent      | `components/audio-player/audio-player.component.spec.ts`           | 13    | Player states, playback controls                        |
| TrustBarComponent         | `components/trust-bar/trust-bar.component.spec.ts`                 | 18    | Trust indicators                                        |
| MetaBarComponent          | `components/meta-bar/meta-bar.component.spec.ts`                   | 11    | Token, duration, latency display                        |
| ProviderSelectorComponent | `components/provider-selector/provider-selector.component.spec.ts` | 9     | Provider chips and selection                            |
| SourceCardComponent       | `components/source-card/source-card.component.spec.ts`             | 7     | Source card rendering                                   |
| RagService                | `services/rag.service.spec.ts`                                     | 40    | `query()`, `fetchResult()`, `stream()`                  |
| TtsService                | `services/tts.service.spec.ts`                                     | 3     | Narrate request                                         |

**Totals:** 46 spec/test files in these four groups (plus one placeholder spec each in `api-e2e` and `web-e2e`). Static counts: API 392 (runner: 404), Shared Types 13, Eval 45, Web 251 (runner: 247). API test runner: Jest via Nx. Eval test runner: Vitest. Web test runner: Vitest via Nx. All external HTTP calls and LLM providers are mocked in tests.

**Jest ESM note:** Test files that import `AgentService` or `LlmService` must mock the LLM provider modules to avoid `@langchain/*` ESM resolution failures. See `agent.service.spec.ts` for the pattern.

---

## 10. What's Next

**M5: Voice Output** (done; ElevenLabs originally, now Mistral Voxtral) -- TTS backend integration and frontend audio player for podcast-style narration of agent responses.

**M7: Deploy & Observability** (~87% complete) -- Remaining items: production monitoring dashboards, alerting setup.

**M8: Pipeline Hardening** (complete) -- LangGraph StateGraph refactor, circuit breaker, SSE mobile resilience with retry/heartbeat/visibility detection, per-stage failure recovery, step streaming.

**Post-M8** (complete) -- Latency work (ADR-009), fail-fast on rejected API keys with `GET /api/health/llm`, narration duration fix, streamed Writer drafts, 15-minute answer replay, follow-up questions, and the opt-in merged writer (ADR-010, off by default).
