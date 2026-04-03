# CLAUDE.md -- VoxPopuli

Project-specific instructions for Claude Code when working in this repository.

## Project Overview

VoxPopuli is an agentic RAG system over Hacker News. See [product.md](product.md) for what and why, [architecture.md](architecture.md) for how.

**Stack:** Nx monorepo, NestJS backend, Angular 17+ frontend, triple-stack LLM (Claude/Mistral/Groq), ElevenLabs TTS, node-cache.

## Repository Structure

```
apps/api/src/       # NestJS backend (agent, cache, chunker, hn, llm, rag, tts modules)
apps/web/src/app/   # Angular frontend (components + services)
libs/shared-types/  # @voxpopuli/shared-types (all API contracts)
evals/              # Evaluation harness (queries, runner, scorer)
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
npx tsx evals/run-eval.ts # Run eval harness
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
- All LLM providers implement `LlmProviderInterface`. Never call provider SDKs directly outside the provider class.
- Use native tool_result protocol per provider (see product.md Section 9). Do not string-hack tool results into messages.

### Angular Frontend

- **Standalone components** (no NgModules).
- **Signals** for reactive state where applicable.
- **Tailwind CSS** for styling. Utility-first, no component CSS files unless necessary.
- SSE via native `EventSource`, not libraries.

### Testing

- Tests live alongside source files (NestJS convention) or in `__tests__/` directories.
- Mock external HTTP calls (HN APIs, LLM providers, ElevenLabs). Never hit real APIs in tests.
- CacheService can be tested with real in-memory cache behavior.
- Every milestone has integration tests. See architecture.md Section 8 for Definition of Done.

## Key Constraints

| Constraint            | Value                       |
| --------------------- | --------------------------- |
| Max agent steps       | 7                           |
| Agent timeout         | 60s                         |
| Concurrent agents     | 5 (semaphore)               |
| Comment cap per story | 30                          |
| Query max length      | 500 chars                   |
| Rate limit (per IP)   | 10 req/min                  |
| Token budget: Claude  | 80k, Mistral 100k, Groq 50k |
| TTS max chars         | 2500                        |

## Environment Variables

The active LLM provider is set via `LLM_PROVIDER` (groq/mistral/claude). Only that provider's API key is required. See `.env.example` for all keys.

## Common Pitfalls

1. **Don't import between NestJS modules directly.** Use module imports and DI.
2. **Don't assume LLM provider.** Always go through `LlmService`, never instantiate providers directly.
3. **Comment tree fetching is slow.** Each Firebase comment is an individual HTTP call. Always respect the 30-comment cap and parallel batching.
4. **Token budgets vary by provider.** Always use `ChunkerService.buildContext()` with the active provider's budget, not a hardcoded number.
5. **SSE events have specific types.** Use `thought`, `action`, `observation`, `answer`, `error` -- don't invent new event types.
6. **TTS rewrite is a separate LLM call.** The podcast script rewriter is not the agent -- it's a lightweight single-turn call via `TtsService.rewriteForSpeech()`.

## Linear Project

Project: [VoxPopuli](https://linear.app/ai-adventures/project/voxpopuli-3e4f9761d135)
Team: AI Adventures
Issues: AI-99 through AI-156
