# M1: Scaffold & Data Layer -- Design Document

**Date:** 2026-04-01
**Status:** Approved
**Milestone:** M1: Scaffold & Data Layer
**Linear Epic:** AI-99 (Project Bootstrap), AI-100 (HN Data Service)
**Demo:** `curl http://localhost:3000/api/health` returns status + cache stats. HnService returns cached HN search results.

---

## Stack Decisions

| Decision        | Choice              | Rationale                                                               |
| --------------- | ------------------- | ----------------------------------------------------------------------- |
| Package manager | pnpm                | Faster than npm, stricter deps, proven in Ledger project                |
| Node.js         | 22 LTS              | Latest LTS, native fetch, best performance                              |
| Nx style        | Integrated monorepo | First-class NestJS + Angular generators, shared dependency graph        |
| NestJS          | 11                  | Latest, Fastify v5 support                                              |
| Angular         | 17+ (Nx default)    | Standalone components, signals                                          |
| AI framework    | LangChain.js        | Handles ReAct loop, tool protocols, multi-provider; used from M2 onward |

## Workspace Structure

```
voxpopuli/
├── apps/
│   ├── api/                        # NestJS 11 backend
│   │   ├── src/
│   │   │   ├── app/                # AppModule + main.ts
│   │   │   ├── cache/              # CacheModule + CacheService
│   │   │   ├── hn/                 # HnModule + HnService
│   │   │   └── health/             # HealthModule + HealthController
│   │   ├── test/                   # E2E / integration tests
│   │   └── project.json
│   └── web/                        # Angular frontend (shell only for M1)
│       ├── src/app/
│       └── project.json
├── libs/
│   └── shared-types/               # @voxpopuli/shared-types
│       └── src/index.ts
├── .github/workflows/ci.yml
├── .env.example
├── .gitignore
├── .prettierrc
├── .eslintrc.json
├── .husky/
├── Makefile
├── Dockerfile
├── docker-compose.yml
├── nx.json
├── pnpm-workspace.yaml
└── package.json
```

## Module Design

### Shared Types (libs/shared-types)

All interfaces defined upfront in `@voxpopuli/shared-types`. Types for M2+ (LLM, Agent, TTS) are defined now to prevent circular dependency issues later.

```typescript
// Core query/response
RagQuery, AgentResponse, AgentStep, AgentSource;

// HN data
HnSearchResult, HnSearchHit, HnStory, HnComment;
StoryChunk, CommentChunk, ContextWindow;

// LLM (defined now, implemented in M2)
ToolDefinition, LlmMessage, LlmResponse, ChatOptions;

// TTS (defined now, implemented in M5)
TtsRequest;

// Cache + Health
CacheStats, HealthResponse;
```

### CacheModule (apps/api/src/cache/)

Thin `@Injectable()` wrapper around `node-cache`.

```typescript
@Injectable()
class CacheService {
  getOrSet<T>(key: string, fetcher: () => Promise<T>, ttlSeconds: number): Promise<T>;
  get<T>(key: string): T | undefined;
  del(key: string): void;
  getStats(): CacheStats; // { hits, misses, keys }
}
```

TTLs configured via constants:

- Search results: 900s (15 min)
- Stories: 3600s (1 hr)
- Comments: 1800s (30 min)
- Query results: 600s (10 min)

### HnModule (apps/api/src/hn/)

Single `HnService` using NestJS `HttpModule` for HTTP calls. Two internal clients (Algolia + Firebase). All calls wrapped with `CacheService.getOrSet()`.

**Algolia client** (`hn.algolia.com/api/v1`):

- `search(query, options?)` -- returns `HnSearchResult`
- `searchByDate(query, options?)` -- date-sorted variant

**Firebase client** (`hacker-news.firebaseio.com/v0`):

- `getItem(id)` -- returns `HnStory | HnComment`
- `getCommentTree(storyId, maxDepth?)` -- returns `HnComment[]`
  - Parallel batches of 10 concurrent fetches
  - Hard cap: 30 comments
  - Skip deleted/dead (don't count toward cap)
  - Default depth: 3, max: 5

### HealthModule (apps/api/src/health/)

Standalone module, not part of RagModule.

```
GET /api/health -> { status: "ok", uptime: number, cacheStats: CacheStats }
```

Integration test verifies 200 response with correct shape.

## Infrastructure

| Story              | Implementation                                                                 |
| ------------------ | ------------------------------------------------------------------------------ |
| .gitignore         | node_modules, dist, .nx, .angular, .env, coverage, .cache, IDE files           |
| ESLint + Prettier  | Nx defaults + TypeScript strict. `@typescript-eslint/no-explicit-any: error`   |
| GitHub Actions CI  | pnpm install, `nx affected:lint`, `nx affected:test`, `nx affected:build`      |
| Pre-commit hooks   | Husky + lint-staged: ESLint + Prettier on staged files                         |
| Structured logging | `nestjs-pino` with JSON output, request/response context                       |
| Graceful shutdown  | `app.enableShutdownHooks()`, ConfigModule with class-validator `@IsNotEmpty()` |
| CORS               | `app.enableCors({ origin: 'http://localhost:4200' })`                          |
| Makefile           | dev, build, test, lint, clean, install targets wrapping nx commands            |
| Docker             | Multi-stage Dockerfile (dev + prod), docker-compose with api service           |
| E2E verify         | Smoke test: serve, build, test all pass; shared-types imports work             |

## Agent Team Execution Plan

5 agents, sequential then parallel:

**Phase 1 (sequential):** Agent 1 creates the scaffold. Must complete before others start.

**Phase 2 (parallel):** Agents 2-5 work concurrently on independent workstreams.

| Agent                   | Phase | Stories                                | Scope                                                          |
| ----------------------- | ----- | -------------------------------------- | -------------------------------------------------------------- |
| Agent 1: Scaffold       | 1     | AI-101, AI-137, AI-156, AI-142, AI-143 | Nx workspace, .gitignore, CORS, graceful shutdown, E2E verify  |
| Agent 2: Types + Health | 2     | AI-102, AI-151                         | Shared types library, health endpoint + integration test       |
| Agent 3: Cache + HN     | 2     | AI-103, AI-104, AI-105, AI-147         | CacheModule, HnService (Algolia + Firebase), integration tests |
| Agent 4: DX Infra       | 2     | AI-138, AI-139, AI-140, AI-152         | ESLint/Prettier, GitHub Actions CI, pre-commit hooks, Makefile |
| Agent 5: Ops            | 2     | AI-141, AI-155                         | Structured logging (nestjs-pino), Docker                       |

## LangChain Impact on M1

Minimal. M1 installs `langchain` and `@langchain/core` as workspace dependencies so the foundation is ready. No LangChain code is written until M2 (providers) and M3 (agent). The decision to use LangChain affects:

- **M2:** `LlmProviderInterface` wraps LangChain `BaseChatModel` instead of raw SDKs. Providers use `@langchain/groq`, `@langchain/anthropic`, `@langchain/mistralai`.
- **M3:** `AgentService` uses `createReactAgent` + `AgentExecutor`. Tools are `DynamicTool` with Zod schemas.
- **Shared types:** `ToolDefinition` becomes simpler (LangChain owns the format). `LlmMessage`/`LlmResponse` may thin out since LangChain handles message types.

## Definition of Done (M1)

Per architecture.md Section 8:

- All 16 stories implemented
- `nx serve api` and `nx serve web` start cleanly
- `curl http://localhost:3000/api/health` returns 200 with cache stats
- HnService integration tests pass (Algolia search, Firebase items, comment tree)
- `nx affected:lint` and `nx affected:test` pass
- CI workflow runs green
- No TypeScript errors, no `any` types
