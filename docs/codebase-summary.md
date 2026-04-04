# VoxPopuli -- Codebase Summary

**Generated:** 2026-04-04
**Covers:** Milestones 1 and 2 (Scaffold & Data Layer, LLM & Chunker)

---

## 1. Project Overview

VoxPopuli is an agentic RAG (Retrieval-Augmented Generation) system that turns Hacker News into a queryable knowledge base. A user submits a natural-language question; an autonomous research agent searches HN stories via Algolia, crawls comment threads from the Firebase API, reasons about the retrieved content through a ReAct loop, and delivers a sourced, synthesized answer. The system supports three LLM providers (Claude, Mistral, Groq), includes a planned voice-output layer via ElevenLabs TTS, and exposes full transparency into the agent's reasoning steps.

---

## 2. Tech Stack

| Layer           | Technology            | Role                                                       |
| --------------- | --------------------- | ---------------------------------------------------------- |
| Monorepo        | Nx                    | Workspace orchestration, task running, dependency graph    |
| Backend         | NestJS 10+            | API framework with module-based DI                         |
| Frontend        | Angular 17+           | SPA with standalone components (scaffolded, not yet built) |
| LLM (quality)   | Claude Sonnet 4       | Anthropic SDK via LangChain `@langchain/anthropic`         |
| LLM (cost)      | Mistral Large 3       | Mistral SDK via LangChain `@langchain/mistralai`           |
| LLM (speed)     | Groq Llama 3.3 70B    | OpenAI-compatible via LangChain `@langchain/groq`          |
| TTS             | ElevenLabs            | Planned -- podcast-style voice narration                   |
| Cache           | node-cache            | In-memory TTL cache with typed get/set                     |
| Shared types    | TypeScript lib        | `@voxpopuli/shared-types` consumed by both apps            |
| Logging         | Pino (nestjs-pino)    | Structured JSON logging, pretty-print in dev               |
| Validation      | class-validator + Zod | Environment variable validation at startup                 |
| HTTP client     | @nestjs/axios         | Algolia and Firebase API calls                             |
| Package manager | pnpm                  | Workspace-aware dependency management                      |
| CI              | GitHub Actions        | Lint and test on affected projects                         |

---

## 3. Milestone Progress

| Milestone | Name                  | Status      | Description                                                                     |
| --------- | --------------------- | ----------- | ------------------------------------------------------------------------------- |
| M1        | Scaffold & Data Layer | Complete    | Nx monorepo, shared types, CacheService, HnService, health endpoint, CI, Docker |
| M2        | LLM & Chunker         | Complete    | ChunkerService, LlmProviderInterface, 3 providers, LlmService facade            |
| M3        | Agent Core            | Not started | ReAct loop, tool dispatch, RagController, SSE streaming                         |
| M4        | Frontend              | Not started | Chat UI, agent step visualization, source cards, provider selector              |
| M5        | Voice Output          | Not started | TTS backend + frontend audio player                                             |
| M6        | Eval Harness          | Not started | Automated quality scoring for agent responses                                   |

---

## 4. Repository Structure

```
voxpopuli/
+-- apps/
|   +-- api/
|   |   +-- src/
|   |       +-- app/                 # AppModule, AppController, AppService, main.ts
|   |       +-- cache/               # CacheModule, CacheService
|   |       +-- chunker/             # ChunkerModule, ChunkerService, chunker.service.spec.ts
|   |       +-- config/              # env.validation.ts (class-validator schema)
|   |       +-- health/              # HealthModule, HealthController, health.controller.spec.ts
|   |       +-- hn/                  # HnModule, HnService, HnController, hn.service.spec.ts
|   |       +-- llm/                 # LlmModule, LlmService, llm-provider.interface.ts
|   |           +-- providers/       # groq.provider.ts, claude.provider.ts, mistral.provider.ts
|   +-- api-e2e/                     # E2E test harness (api.spec.ts)
|   +-- web/                         # Angular frontend (scaffolded, default Nx template)
|   +-- web-e2e/                     # Frontend E2E placeholder
+-- libs/
|   +-- shared-types/src/lib/        # shared-types.ts (all API contracts)
+-- docs/
|   +-- adr/                         # ADR-002, ADR-003
|   +-- adrs/                        # ADR-001
|   +-- plans/                       # M1 design document
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

| Provider | Class             | LangChain Model | Model ID                   | Context Window |
| -------- | ----------------- | --------------- | -------------------------- | -------------- |
| Groq     | `GroqProvider`    | `ChatGroq`      | `llama-3.3-70b-versatile`  | 128,000 tokens |
| Claude   | `ClaudeProvider`  | `ChatAnthropic` | `claude-sonnet-4-20250514` | 200,000 tokens |
| Mistral  | `MistralProvider` | `ChatMistralAI` | `mistral-large-latest`     | 262,000 tokens |

All providers implement `LlmProviderInterface` with three members: `name`, `maxContextTokens`, and `getModel()`. Each wraps a LangChain `BaseChatModel` instance that is lazily created on first access.

### 5.6 ConfigModule (`apps/api/src/config/`)

| Attribute          | Value                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose            | Environment variable validation at application startup                                                                                                   |
| Key export         | `validate()` function used by `ConfigModule.forRoot()`                                                                                                   |
| Validation library | `class-validator` + `class-transformer`                                                                                                                  |
| Key class          | `EnvironmentVariables` with decorated fields                                                                                                             |
| Required vars      | `LLM_PROVIDER` (default: `groq`)                                                                                                                         |
| Optional vars      | `GROQ_API_KEY`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`, `PORT`, `LOG_LEVEL`, `NODE_ENV` |

### 5.7 AppModule (`apps/api/src/app/`)

| Attribute | Value                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| Purpose   | Root NestJS module wiring all feature modules together                                                                  |
| Imports   | `ConfigModule` (global), `LoggerModule` (pino), `CacheModule`, `HealthModule`, `HnModule`, `ChunkerModule`, `LlmModule` |
| Bootstrap | `main.ts` configures global prefix (`/api`), CORS (localhost:4200), graceful shutdown, Pino logger                      |

---

## 6. Shared Types

All interfaces live in `libs/shared-types/src/lib/shared-types.ts` and are imported as `@voxpopuli/shared-types`.

### Core Query/Response

| Interface       | Purpose                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `RagQuery`      | Inbound query shape: `query`, `maxSteps?`, `includeComments?`, `provider?`                    |
| `AgentResponse` | Top-level response: `answer`, `steps[]`, `sources[]`, `meta`                                  |
| `AgentStep`     | Single reasoning step: type (`thought`/`action`/`observation`), content, tool info, timestamp |
| `AgentSource`   | Referenced HN story: storyId, title, url, author, points, commentCount                        |
| `AgentMeta`     | Run metadata: provider, token counts, duration, cached flag                                   |

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

| ADR     | Title                                              | Date       | Summary                                                                                                                   |
| ------- | -------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 | CI/CD Pipeline and Quality Gates                   | 2026-04-03 | Defines GitHub Actions CI pipeline and pre-commit hook strategy for lint/test quality gates                               |
| ADR-002 | Chunker Strategy and Token Budget Design           | 2026-04-04 | Character-based token estimation (1 token ~ 4 chars), 4-phase priority budget allocation, HTML-to-markdown conversion     |
| ADR-003 | LLM Provider Architecture and Tool Protocol Design | 2026-04-04 | LangChain-based provider interface with facade pattern, lazy instantiation, and native tool-calling protocol per provider |

### Design Documents

| Document                         | Date       | Scope                                                                                  |
| -------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| M1: Scaffold & Data Layer Design | 2026-04-01 | Nx monorepo structure, CacheService design, HnService API design, health endpoint spec |

---

## 9. Test Summary

| Test Suite       | File                               | Tests                                                                                                   | Covers |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| HealthController | `health/health.controller.spec.ts` | Health endpoint response shape and values                                                               |
| HnService        | `hn/hn.service.spec.ts`            | Algolia search, Firebase item fetch, comment tree building, caching, error handling                     |
| ChunkerService   | `chunker/chunker.service.spec.ts`  | Token estimation, HTML stripping, story chunking, comment chunking, context assembly, prompt formatting |
| LlmService       | `llm/llm.service.spec.ts`          | Provider resolution, lazy instantiation, provider override, unknown provider errors                     |

**Totals:** 4 test suites, 77 tests, all passing. Test runner: Jest via Nx. All external HTTP calls are mocked. No tests hit real APIs.

Additional test files exist but are scaffolded defaults:

- `apps/api-e2e/src/api/api.spec.ts` -- E2E test harness (Nx default)
- `apps/web/src/app/app.spec.ts` -- Angular app component test (Nx default)
- `apps/web-e2e/src/example.spec.ts` -- Frontend E2E placeholder

---

## 10. What's Next -- M3: Agent Core

Milestone 3 builds the ReAct agent loop and the RAG API endpoints. Based on the architecture plan, it consists of two epics and approximately 8 stories:

**Epic 3.1: ReAct Agent**

- Define agent tools (`search_hn`, `get_story`, `get_comments`) in `tools.ts`
- Write the system prompt in `system-prompt.ts`
- Implement `AgentService.run()` with the ReAct loop (think, act, observe, repeat)
- Tool dispatch through `executeTool()` to HnService
- Chunk tool results via ChunkerService, build native tool_result messages via the active LLM provider
- Enforce constraints: max 7 steps, 60-second timeout, 5 concurrent runs via semaphore
- Integration tests for AgentService

**Epic 3.2: RAG Endpoints**

- `POST /api/rag/query` -- blocking full response
- `GET /api/rag/stream` -- SSE streaming of reasoning steps (event types: thought, action, observation, answer, error)
- Rate limiting middleware (10/min per IP, 60/min global)
- Query result caching (10-minute TTL)
- Input validation (query required, 500 char max)
- Global exception filter
- Integration tests for RagController

**Demo target:** `curl POST /api/rag/query` returns a full `AgentResponse` with steps and sources.
