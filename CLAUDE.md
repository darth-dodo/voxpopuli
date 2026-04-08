# CLAUDE.md -- VoxPopuli

Project-specific instructions for Claude Code when working in this repository.

## Project Overview

VoxPopuli is an agentic RAG system over Hacker News. See [product.md](product.md) for what and why, [architecture.md](architecture.md) for how.

**Stack:** Nx monorepo, NestJS backend, Angular 17+ frontend, triple-stack LLM (Claude/Mistral/Groq), ElevenLabs TTS, node-cache.

## Repository Structure

```
apps/api/src/          # NestJS backend (agent, cache, chunker, hn, llm, rag, tts modules)
  agent/               #   AgentService — ReAct loop, tools, system prompt, trust metadata
    agent.service.ts   #     Core ReAct loop via LangChain createAgent
    tools.ts           #     search_hn, get_story, get_comments (LangChain tool() + Zod)
    system-prompt.ts   #     Agent system prompt with claim taxonomy
    trust.ts           #     computeTrustMetadata — source verification, recency, diversity
    partial-response.ts #    buildPartialResponse — graceful degradation on LLM failure
  rag/                 #   RagController — POST /query, GET /stream (SSE), rate limiting
    filters/           #     HttpExceptionFilter — global structured error responses
    dto/               #     RagQueryDto — input validation
  chunker/             #   ChunkerService — token-aware context building and formatting
  llm/                 #   LlmService facade + provider implementations
    providers/         #     groq.provider, claude.provider, mistral.provider
    llm-provider.interface.ts
  cache/               #   CacheService — in-memory caching layer
  hn/                  #   HN API client (stories, comments, search, retry with backoff)
apps/web/src/app/      # Angular frontend (Data Noir Editorial design system)
  components/           #   UI components
    agent-steps/        #     Agent reasoning timeline (compact merged rows)
    chat/               #     Main chat page (landing + results + streaming)
    meta-bar/           #     Response metadata display
    provider-selector/  #     LLM provider chip selector
    source-card/        #     HN story source card
    trust-bar/          #     Trust metadata indicators
  pages/
    design-system/      #     Design system showcase page
  services/
    rag.service.ts      #     HTTP + SSE client for RAG endpoints
libs/shared-types/     # @voxpopuli/shared-types (all API contracts + trust framework types)
docs/adr/              # Architecture Decision Records
evals/                 # Evaluation harness (queries, runner, scorer, LangSmith integration)
  queries.json         #   27 test queries (20 general + 7 trust-specific)
  run-eval.ts          #   CLI entry point: runs queries against live API
  dataset.ts           #   LangSmith dataset sync helper
  score.ts             #   Score aggregation and reporting
  types.ts             #   EvalQuery, EvalRunResult, EvalScore, EvalReport
  evaluators/          #   Custom evaluators (source-accuracy, quality-judge, efficiency, latency, cost)
```

## Development Commands

```bash
npx nx serve api          # Backend on :3000
npx nx serve web          # Frontend on :4200
npx nx test               # Run all tests
npx nx affected:test      # Run tests for changed code only
npx nx affected:lint      # Lint changed code only
npx nx build api          # Build backend
npx nx build web          # Build frontend
npx tsx evals/run-eval.ts               # Run eval harness (requires running API)
npx tsx evals/run-eval.ts --provider groq  # Run with specific provider
npx tsx evals/run-eval.ts --query q01      # Run single query (for debugging)
npx tsx evals/run-eval.ts --compare groq,mistral,claude  # Compare providers
```

## Code Conventions

### TypeScript

- **Strict mode enabled.** No `any` types without explicit justification.
- All shared interfaces live in `@voxpopuli/shared-types`. Import from there, not local copies.
- JSDoc on all public methods.

### NestJS Backend

- **One module per domain:** agent, cache, chunker, hn, llm, rag, tts.
- **Stateless services.** No mutable state outside CacheService.
- **Dependency injection** for all service dependencies. No direct imports between modules.
- All external API calls go through CacheService (`getOrSet<T>()` pattern).
- All LLM providers implement `LlmProviderInterface` and wrap LangChain `ChatModel` instances. Never call LangChain provider SDKs (`@langchain/anthropic`, `@langchain/mistralai`, `@langchain/groq`) directly outside the provider class.
- Use native tool_result protocol per provider (see product.md Section 9). Do not string-hack tool results into messages.
- **AgentService** uses LangChain `createAgent` (v1.2+) with `tool()` helper for typed tools. Do not use the deprecated `createReactAgent` + `AgentExecutor` API.
- **Agent tools** are defined in `agent/tools.ts`. Each wraps an HnService method and returns chunked string output via ChunkerService. Add new tools following the same `tool()` + Zod schema pattern.
- **Trust metadata** is computed post-loop by the pure function `computeTrustMetadata()` in `agent/trust.ts`. It has no NestJS dependencies.
- **ChunkerService** uses character-based token estimation (1 token ≈ 4 chars). Token budget priority: metadata > story text > top-level comments > nested comments.

### Angular Frontend

- **Standalone components** (no NgModules).
- **Signals** for reactive state where applicable.
- **Tailwind CSS v4** for styling. CSS-first config via `@theme` block in `styles.css` (no `tailwind.config.js`).
- **Design system: "Data Noir Editorial"** with light theme support. Light/dark theme via CSS variable overrides (`.light` class on `<html>`).
- **`ngx-markdown`** for answer rendering (Markdown-to-HTML in the chat component).
- SSE via native `EventSource`, not libraries.
- Proxy config at `apps/web/proxy.conf.json` for dev server to API forwarding.
- Angular 21's Vite-based dev server requires `/api/**` glob pattern for proxy routes.

### Testing

- Tests live alongside source files (NestJS convention) or in `__tests__/` directories.
- Mock external HTTP calls (HN APIs, LLM providers, ElevenLabs). Never hit real APIs in tests.
- CacheService can be tested with real in-memory cache behavior.
- Every milestone has integration tests. See architecture.md Section 8 for Definition of Done.

## Key Constraints

| Constraint            | Value                                                          |
| --------------------- | -------------------------------------------------------------- |
| Max agent steps       | 7 (hard exit after 7 actions, not just recursion limit)        |
| Agent timeout         | 180s                                                           |
| Concurrent agents     | 5 (semaphore)                                                  |
| Comment cap per story | 30                                                             |
| Query max length      | 500 chars                                                      |
| Rate limit (global)   | 60 req/min                                                     |
| Token budget: Claude  | 80k, Mistral 100k, Groq 50k                                    |
| TTS max chars         | 2500                                                           |
| Eval query count      | 27 (20 general + 7 trust)                                      |
| Eval pass threshold   | 0.6 weighted score                                             |
| Eval judge provider   | Mistral (configurable via EVAL_JUDGE_PROVIDER)                 |
| Eval score weights    | Source 30%, Quality 30%, Efficiency 15%, Latency 15%, Cost 10% |

## Environment Variables

The active LLM provider is set via `LLM_PROVIDER` (groq/mistral/claude). Only that provider's API key is required. See `.env.example` for all keys.

## Common Pitfalls

1. **Don't import between NestJS modules directly.** Use module imports and DI.
2. **Don't assume LLM provider.** Always go through `LlmService`, never instantiate providers directly.
3. **Comment tree fetching is slow.** Each Firebase comment is an individual HTTP call. Always respect the 30-comment cap and parallel batching.
4. **Token budgets vary by provider.** Always use `ChunkerService.buildContext()` with the active provider's budget, not a hardcoded number.
5. **SSE events have specific types.** Use `thought`, `action`, `observation`, `answer`, `error` -- don't invent new event types.
6. **TTS rewrite is a separate LLM call.** The podcast script rewriter is not the agent -- it's a lightweight single-turn call via `TtsService.rewriteForSpeech()`.
7. **Don't import LangChain packages directly.** All LangChain usage is encapsulated inside `apps/api/src/llm/providers/` and `apps/api/src/agent/`. Consuming code should only depend on `LlmService`, `AgentService`, or the tool factories.
8. **Token estimation is approximate.** ChunkerService uses a 4-chars-per-token heuristic, not a real tokenizer. Don't rely on exact token counts.
9. **Agent tests need LLM provider mocks.** Jest can't resolve `@langchain/*` ESM packages. Always mock the provider modules (`jest.mock('../llm/providers/groq.provider', ...)`) in test files that transitively import `AgentService` or `LlmService`.
10. **SSE streams mid-loop via AsyncGenerator.** `AgentService.runStream()` yields step events during the ReAct loop. `RagController.stream()` converts the generator to an Observable for NestJS `@Sse`. The blocking `run()` method consumes `runStream()` internally.
11. **Trust metadata depends on tool usage.** Source age and recency metrics require the agent to call `get_story` (which emits "Posted: YYYY-MM-DD"). Search-only runs will have `avgSourceAge: 0`.
12. **Angular 21 uses Vite-based dev server.** Proxy patterns need `/api/**` glob, not `/api`.
13. **Tailwind v4 `@theme` spacing tokens override default utilities.** Don't define `--spacing-sm/md/lg/xl` as they shadow built-in spacing scale.
14. **`model()` is required for two-way binding.** Use `model()` for `[()]` syntax, not `signal()`. Signals are read-only from the parent's perspective.
15. **Eval harness is black-box.** Evaluators call the API over HTTP, never import NestJS services. The one exception: the LLM-as-judge makes direct Mistral API calls (not through the VoxPopuli API).
16. **LangSmith tracing is automatic.** Set `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` -- LangChain.js handles the rest. No code changes needed in the agent.
17. **Eval queries.json is the source of truth.** The LangSmith dataset is synced from this file on each run. Edit queries in the JSON file, not the LangSmith UI.

## Architecture Decision Records

ADRs live in `docs/adr/` and document key design choices. Consult these before proposing changes to the areas they cover:

- `002-chunker-strategy.md` — Token-aware context building approach
- `003-llm-provider-architecture.md` — LangChain provider facade pattern
- `004-react-agent-design.md` — ReAct agent design, tool selection, LangChain createAgent (v1.2+)
- `005-true-sse-streaming.md` — AsyncGenerator-based mid-loop SSE streaming

## Linear Project

Project: [VoxPopuli](https://linear.app/ai-adventures/project/voxpopuli-3e4f9761d135)
Team: AI Adventures
Issues: AI-99 through AI-165+
