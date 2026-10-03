# CLAUDE.md -- VoxPopuli

Project-specific instructions for Claude Code when working in this repository.

## Project Overview

VoxPopuli is an agentic RAG system over Hacker News. See [product.md](docs/product.md) for what and why, [architecture.md](docs/architecture.md) for how.

**Stack:** Nx monorepo, NestJS backend, Angular 21 frontend, triple-stack LLM (Claude/Mistral/OpenRouter), Mistral Voxtral TTS, node-cache.

## Repository Structure

```
apps/api/src/          # NestJS backend (agent, cache, chunker, health, hn, llm, rag, tts modules)
  agent/               #   AgentService — ReAct loop, tools, system prompt, trust metadata
    agent.service.ts   #     Core ReAct loop via LangChain createAgent
    tools.ts           #     search_hn, get_story, get_comments (LangChain tool() + Zod); fill the per-request SourceRegistry
    system-prompt.ts   #     Agent system prompt with claim taxonomy
    trust.ts           #     computeTrustMetadata — source verification, recency, diversity
    partial-response.ts #    buildPartialResponse — graceful degradation on LLM failure
    fallback-response.ts #   buildFallbackResponse — answer from analysis when the Writer fails twice
    orchestrator.service.ts  #   OrchestratorService — LangGraph pipeline coordinator, legacy fallback, follow-ups
    pipeline-graph.ts        #   StateGraph annotation, withRetry / withWriterFallback wrappers
    nodes/                   #   Pipeline agent nodes
      retriever.node.ts      #     ReAct collection + compaction → EvidenceBundle
      compaction-parse.ts    #     parseCompactedThemes — lenient theme parsing, salvage before JSON errors
      parse-llm-json.ts      #     cleanLlmOutput — strip fences/think tags before JSON.parse
      synthesizer.node.ts    #     EvidenceBundle → AnalysisResult; applyEvidenceFloor; merged-mode stand-in
      writer.node.ts         #     AnalysisResult (or evidence, merged mode) → AgentResponseV2
      writer-draft.ts        #     WriterDraftStreamer — live markdown draft as `token` events
    prompts/                 #   Pipeline agent system prompts
      retriever.prompt.ts    #     ReAct collection strategy
      compactor.prompt.ts    #     Raw data → structured EvidenceBundle themes
      synthesizer.prompt.ts  #     Bundle → insights + contradictions
      writer.prompt.ts       #     Analysis → editorial prose
      merged-writer.prompt.ts #    Evidence → analysis + prose in one call (PIPELINE_MERGED_WRITER)
  rag/                 #   RagController — POST /query, GET /stream (SSE, followUpOf), GET /query/:id/result, rate limiting
    filters/           #     HttpExceptionFilter — global structured error responses
    dto/               #     RagQueryDto — input validation
  chunker/             #   ChunkerService — token-aware context building and formatting
  llm/                 #   LlmService facade + provider implementations
    providers/         #     openrouter.provider, claude.provider, mistral.provider (FailFastChatMistralAI)
    llm-provider.interface.ts  # LlmProviderInterface, ModelOptions ({ maxTokens })
    llm-errors.ts      #     isAuthError, LlmAuthError, failFastOnClientError, PROVIDER_KEY_ENV
    invoke-with-retry.ts #   invokeWithRetry — backoff on tokens-per-minute limits
    model-ids.ts       #     Model IDs per provider
  cache/               #   CacheService — in-memory caching layer
    query-store.ts     #     QueryStore — stored results, dedup, 15-min replay, follow-up evidence
  health/              #   GET /health, GET /health/llm (cached 60s live provider probe)
  hn/                  #   HN API client (stories, comments, search, retry with backoff)
  tts/                 #   TtsService (Mistral Voxtral), narration rewrite prompt
    mp3-xing.ts        #     addXingHeader — fixes VBR MP3 duration on WebKit/iOS
apps/web/src/app/      # Angular frontend (Data Noir Editorial design system)
  components/           #   UI components
    agent-steps/        #     Agent reasoning timeline (compact merged rows, stage timer cap)
    audio-player/       #     Listen mode player (iOS gesture unlock, speed, download)
    chat/               #     Main chat page (landing + results + streaming + live draft + follow-up + cancel + stall recovery)
    meta-bar/           #     Response metadata display
    provider-selector/  #     LLM provider chip selector
    source-card/        #     HN story source card
    trust-bar/          #     Trust metadata indicators
  pages/
    design-system/      #     Design system showcase page
  services/
    rag.service.ts      #     HTTP + SSE client for RAG endpoints
    tts.service.ts      #     Narration client
libs/shared-types/     # @voxpopuli/shared-types (all API contracts + trust framework types)
docs/adr/              # Architecture Decision Records (002–010)
docs/adrs/             # ADR-001 (CI/CD and quality gates)
evals/                 # Evaluation harness (queries, runner, scorer, LangSmith integration)
  queries.json         #   27 test queries (20 general across 6 categories + 7 trust)
  run-eval.ts          #   CLI entry point (commander); pipeline over SSE by default
  stream-client.ts     #   SSE client — per-stage timings, fallback detection
  latency-stats.ts     #   summary.latency (mean/p50/p95, stage means), --baseline diff
  dataset.ts           #   LangSmith dataset sync helper
  score.ts             #   Score aggregation and reporting
  feedback.ts          #   Post eval scores to LangSmith as run feedback
  types.ts             #   EvalQuery, EvalRunResult, EvalScore, EvalReport
  evaluators/          #   Custom evaluators (source-accuracy, quality-judge, efficiency, latency, cost)
```

## Development Commands

```bash
pnpm exec nx serve api          # Backend on :3000
pnpm exec nx serve web          # Frontend on :4200
pnpm exec nx run-many -t test   # Run all tests
pnpm exec nx affected -t test   # Run tests for changed code only
pnpm exec nx affected -t lint   # Lint changed code only
pnpm exec nx build api          # Build backend
pnpm exec nx build web          # Build frontend
pnpm exec tsx evals/run-eval.ts               # Run eval harness (requires running API; pipeline over SSE by default)
pnpm exec tsx evals/run-eval.ts --help         # Show all CLI options
pnpm exec tsx evals/run-eval.ts --list         # Browse queries by category
pnpm exec tsx evals/run-eval.ts -p mistral     # Run with specific provider
pnpm exec tsx evals/run-eval.ts -p openrouter -n 5 # Max parallelism (5 concurrent)
pnpm exec tsx evals/run-eval.ts --no-judge     # Fast mode (skip LLM-as-judge)
pnpm exec tsx evals/run-eval.ts -C trust       # Run only trust category
pnpm exec tsx evals/run-eval.ts -q q01         # Single query for debugging
pnpm exec tsx evals/run-eval.ts --dry-run      # Preview without calling API
pnpm exec tsx evals/run-eval.ts -c openrouter,mistral,claude  # Compare providers
pnpm exec tsx evals/run-eval.ts -n 1 --baseline <results.json>  # Latency A/B vs a saved report (ADR-009)
pnpm exec tsx evals/run-eval.ts --legacy       # Legacy single-agent path (users only hit it on fallback)
pnpm exec tsx evals/run-eval.ts --no-stream    # POST /rag/query instead of SSE (cached 10 min, no stage timings)
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
- All LLM providers implement `LlmProviderInterface` and wrap LangChain `ChatModel` instances. Never call LangChain provider SDKs (`@langchain/anthropic`, `@langchain/mistralai`, `@langchain/openai`) directly outside the provider class.
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
- SSE via native `EventSource`, not libraries. RagService includes stall detection (300s watchdog, checks every 5s while page visible).
- **Streaming UX**: Sticky header with backdrop-blur on the results page. Submitted query shown below header during results. Cancel button available on both pipeline and legacy streaming states. Wall-clock based elapsed timer resilient to background throttling. While the Writer streams, `token` events accumulate in `tokenContent` and render as a "Drafting answer…" card (`data-testid="answer-draft"`); the final `answer` replaces it.
- **Follow-ups**: After a completed pipeline answer, an "Ask a follow-up using these sources" box (`data-testid="follow-up"`) calls `submitFollowUp()`, which streams with `followUpOf=<queryId>` so the backend answers from the stored evidence instead of searching HN again.
- **Background tab handling**: When the page returns from background during a stream, ChatComponent kills the stale SSE subscription and fetches the stored result via the query result endpoint. If the query is still running (202 response), it reconnects the SSE stream automatically. Backend query deduplication prevents duplicate agent runs on reconnect. Event handling logic is shared between the initial submit path and the reconnect path via a common handler method.
- **Homepage design**: `vp-noise` texture, radial amber gradient on hero, masthead rule beneath title, editorial timeline layout (replacing "How It Works"), example preview card matching actual answer view with trust indicators, footer with "Try it now" scroll CTA and v0.8 version badge, example cards in 3x2 grid with numbered labels.
- Proxy config at `apps/web/proxy.conf.json` for dev server to API forwarding.
- Angular 21's Vite-based dev server requires `/api/**` glob pattern for proxy routes.

### Testing

- Tests live alongside source files (NestJS convention) or in `__tests__/` directories.
- Mock external HTTP calls (HN APIs, LLM providers, Voxtral TTS `fetch`). Never hit real APIs in tests.
- CacheService can be tested with real in-memory cache behavior.
- Every milestone has integration tests. See architecture.md Section 8 for Definition of Done.

## Key Constraints

| Constraint                 | Value                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Max agent steps            | 7 (hard exit after 7 actions, not just recursion limit)                                                                      |
| Agent timeout              | 180s                                                                                                                         |
| Concurrent agents          | 5 (semaphore)                                                                                                                |
| Comment cap per story      | 30                                                                                                                           |
| Query max length           | 500 chars                                                                                                                    |
| Rate limit (global)        | 60 req/min                                                                                                                   |
| Token budget: Claude       | 80k, Mistral 100k, OpenRouter 50k                                                                                            |
| TTS max chars              | 2500                                                                                                                         |
| Eval query count           | 27: 20 general (tool_comparison, opinion, specific_project, recent_events, deep_dive, edge_case) + 7 trust                   |
| Eval default path          | Multi-agent pipeline over SSE (`--legacy`, `--no-stream` opt out)                                                            |
| Eval pass threshold        | 0.6 weighted score                                                                                                           |
| Eval judge provider        | Mistral (configurable via EVAL_JUDGE_PROVIDER)                                                                               |
| Eval score weights         | Source 30%, Quality 30%, Efficiency 15%, Latency 15%, Cost 10%                                                               |
| Eval concurrency           | 3 default, 5 max                                                                                                             |
| Eval timeout               | 300s default per query                                                                                                       |
| Pipeline feature flag      | `useMultiAgent=true` query param on SSE endpoint selects the pipeline; omitted → legacy agent (frontend always sends `true`) |
| Pipeline stages            | Retriever (ReAct+compact) → Synthesizer → Writer                                                                             |
| Pipeline timeout           | None enforced: `PipelineConfig.timeout` (30s) and `tokenBudgets` exist in the schema but nothing reads them                  |
| Retriever ReAct output cap | 768 tokens (`RETRIEVER_REACT_MAX_TOKENS`)                                                                                    |
| Filtered search retry      | `search_hn` retries without `min_points` below 3 hits (`MIN_FILTERED_HITS`)                                                  |
| Thin-evidence floor        | < 3 sources caps confidence (≤1 → low, 2 → medium) + adds a gap (`THIN_EVIDENCE_SOURCES`)                                    |
| Completed-answer replay    | 15 min (`COMPLETED_TTL` in QueryStore)                                                                                       |
| Follow-up evidence         | 30 min (`EVIDENCE_TTL` in QueryStore)                                                                                        |
| `/health/llm` cache        | 60s                                                                                                                          |
| `POST /rag/query` cache    | 10 min                                                                                                                       |
| Stage timer cap            | 180s (MAX_STAGE_ELAPSED_MS in AgentStepsComponent)                                                                           |
| SSE stall timeout          | 300s watchdog in RagService (checks every 5s, only when page visible)                                                        |

## Environment Variables

The active LLM provider is set via `LLM_PROVIDER` (openrouter/mistral/claude), defaulting to `mistral`. Only that provider's API key is required. The frontend also defaults to Mistral via the `selectedProvider` model signal. See `.env.example` for all keys.

**Merged writer:** `PIPELINE_MERGED_WRITER=true` (default `false`) swaps the Synthesizer for `createMergedSynthesizerNode()` (no LLM call; `analysisFromThemes()`) and runs the Writer in `fromEvidence` mode with `MERGED_WRITER_SYSTEM_PROMPT`. See ADR-010.

**OpenRouter:** `OpenRouterProvider` uses LangChain `ChatOpenAI` pointed at `https://openrouter.ai/api/v1` (requires `OPENROUTER_API_KEY`). The model is an OpenRouter slug in `model-ids.ts` (`OPENROUTER_MODEL_ID`, currently `qwen/qwen3-235b-a22b-2507`; override with the `OPENROUTER_MODEL` env var). The class accepts `{ name, model, maxContextTokens }` so more OpenRouter-backed providers can be registered in `PROVIDER_FACTORIES` without new classes — the long-term plan is to route every provider through OpenRouter. `@langchain/openai` is pinned to `1.4.1` because newer versions require `@langchain/core` >= 1.1.48.

## Common Pitfalls

1. **Don't import between NestJS modules directly.** Use module imports and DI.
2. **Don't assume LLM provider.** Always go through `LlmService`, never instantiate providers directly.
3. **Comment tree fetching is slow.** Each Firebase comment is an individual HTTP call. Always respect the 30-comment cap. `getCommentTree()` fetches one depth level at a time with all parents in parallel — don't reintroduce per-comment `await`s.
4. **Token budgets vary by provider.** Always use `ChunkerService.buildContext()` with the active provider's budget, not a hardcoded number.
5. **SSE events have specific types.** Use `thought`, `action`, `observation`, `answer`, `error` (plus `init` and keep-alive `ping` on every stream, and `pipeline`/`token` in pipeline mode) -- don't invent new event types. `token` carries append-only markdown deltas of the answer while the Writer streams; the final `answer` replaces the draft.
6. **TTS rewrite is a separate LLM call.** The podcast script rewriter is not the agent -- it's a lightweight single-turn call via `TtsService.rewriteForSpeech()`. Speech itself comes from **Mistral Voxtral TTS** (`POST https://api.mistral.ai/v1/audio/speech`, `MISTRAL_API_KEY`) via a raw `fetch` in `TtsService.synthesize()`: model `MISTRAL_TTS_MODEL` (default `voxtral-mini-tts-latest`), voice `MISTRAL_TTS_VOICE` (default preset `en_paul_neutral`; list presets with `GET /v1/audio/voices`, custom cloned voices are UUIDs). The response is JSON `{ audio_data: <base64 MP3> }`, returned to the client as one `audio/mpeg` body. Upstream failures throw `TtsUpstreamError` → HTTP 502 with Mistral's reason (e.g. unknown voice). Voxtral's MP3 is VBR with no Xing header, so `synthesize()` runs it through `addXingHeader()` (`tts/mp3-xing.ts`); without it WebKit/iOS Safari ends playback at a 10-20% short duration estimate. On the frontend, `AudioPlayerComponent` must create and `play()` its audio element synchronously in the Listen click (iOS gesture rule) and reuse it for the narration.
7. **Don't import LangChain packages directly.** All LangChain usage is encapsulated inside `apps/api/src/llm/providers/` and `apps/api/src/agent/`. Consuming code should only depend on `LlmService`, `AgentService`, or the tool factories.
8. **Token estimation is approximate.** ChunkerService uses a 4-chars-per-token heuristic, not a real tokenizer. Don't rely on exact token counts.
9. **Agent tests need LLM provider mocks.** Jest can't resolve `@langchain/*` ESM packages. Always mock the provider modules (`jest.mock('../llm/providers/openrouter.provider', ...)`) in test files that transitively import `AgentService` or `LlmService`.
10. **SSE streams mid-loop via AsyncGenerator.** `AgentService.runStream()` yields step events during the ReAct loop. `RagController.stream()` converts the generator to an Observable for NestJS `@Sse`. The blocking `run()` method consumes `runStream()` internally.
11. **Trust metadata depends on tool usage.** Source age and recency metrics require the agent to call `get_story` (which emits "Posted: YYYY-MM-DD"). Search-only runs will have `avgSourceAge: 0`. (Each source's `postedDate` comes from the `SourceRegistry`, but trust recency still parses `Posted:` lines from observations.)
12. **Angular 21 uses Vite-based dev server.** Proxy patterns need `/api/**` glob, not `/api`.
13. **Tailwind v4 `@theme` spacing tokens override default utilities.** Don't define `--spacing-sm/md/lg/xl` as they shadow built-in spacing scale.
14. **`model()` is required for two-way binding.** Use `model()` for `[()]` syntax, not `signal()`. Signals are read-only from the parent's perspective.
15. **Eval harness is black-box.** Evaluators call the API over HTTP, never import NestJS services. The one exception: the LLM-as-judge makes direct Mistral API calls (not through the VoxPopuli API).
16. **LangSmith tracing is automatic.** Set `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` -- LangChain.js handles the rest. No code changes needed in the agent.
17. **Eval queries.json is the source of truth.** The LangSmith dataset is synced from this file on each run. Edit queries in the JSON file, not the LangSmith UI.
18. **LLM judge strips markdown fences.** If you change the judge provider, verify it handles fencing correctly -- some providers wrap JSON output in triple-backtick blocks.
19. **Agent token tracking uses LangChain `usage_metadata`.** If tokens show as 0, the provider may not report them.
20. **Don't mix pipeline and legacy event types.** The frontend detects pipeline mode from `pipeline` SSE events. Legacy `thought`/`action`/`observation` events come from the Retriever's inner ReAct loop within the pipeline — they coexist, not replace. During fallback, `runWithFallback` only emits pipeline error events for stages that had not already completed, avoiding contradictory done-then-error sequences for a single stage.
21. **LangGraph Annotation types must match node return types.** If you change what a node returns, update the StateGraph annotation. Zod 4's `.default()` on nested objects needs a factory function, not `{}`.
22. **SSE stall detection in RagService.** A 300s watchdog (`STALL_TIMEOUT_MS`) fires `handleStall()` if no events arrive while the page is visible. Don't remove the `lastEventTime = Date.now()` bump in the event handler — it resets the watchdog on every received event.
23. **Pipeline stage timer cap.** AgentStepsComponent caps live elapsed at 180s (`MAX_STAGE_ELAPSED_MS`) to prevent runaway counters on stalled connections. The timer stops updating for a stage once it hits the cap.
24. **Query result 202 response is a full QueryResult shape.** The `getResult` endpoint returns a complete `QueryResult` object (enforced via `satisfies QueryResult`) even when the query is still running (202). Do not assume any fields are missing from the 202 response body.
25. **Don't make the LLM transcribe structured data (ADR-009).** Output tokens dominate latency (~5s per 1k). Source metadata comes from the `SourceRegistry` filled by the tools; the compactor emits only `themes` and the writer only prose. Never add `sources`/`allSources` back to an LLM output schema.
26. **The Retriever ReAct model is output-capped** (`RETRIEVER_REACT_MAX_TOKENS`, via `LlmService.getModel(provider, { maxTokens })`). Hitting the recursion limit compacts what was collected instead of failing into the legacy fallback.
27. **Rejected API keys fail fast, not into the fallback.** `isAuthError()` (`llm/llm-errors.ts`) recognizes 401/403 from every provider; the orchestrator then throws `LlmAuthError` (names the env var to fix) instead of re-running the legacy agent on the same bad key. `GET /api/health/llm` makes a cached 1-token call to confirm the active key works — use it after changing provider secrets; keep Render's health check on the cheap `/api/health`.
28. **Mistral retries go through `FailFastChatMistralAI`.** Upstream `ChatMistralAI` retries every error except 400 because the Mistral SDK reports `statusCode` (not `status`), so a bad key used to hang ~2 minutes. The subclass disables inner retries and wraps calls with `failFastOnClientError`. Keep it if you upgrade `@langchain/mistralai`, unless upstream fixes the status mapping.
29. **Completed answers are replayed for 15 minutes.** `QueryStore.findReusable()` returns a running query (attach) or one completed within `COMPLETED_TTL` (replay, `meta.cached: true`). Keys normalize case/whitespace and include the mode (`<provider>:pipeline` / `:legacy`, plus `:followup:<parentId>` for follow-ups). When testing a pipeline change locally, vary the question or restart the API, or you'll measure a replay.
30. **Follow-ups reuse stored evidence.** Completed pipeline runs keep `PriorEvidence` (bundle + retriever steps) for 30 min; `?followUpOf=<queryId>` swaps the Retriever for a node returning it. Source metadata, including `postedDate`, comes from the tools' `SourceRegistry`, never from parsing tool text.

## Architecture Decision Records

ADRs live in `docs/adr/` (plus `docs/adrs/001-ci-cd-and-quality-gates.md`) and document key design choices. Consult these before proposing changes to the areas they cover:

- `docs/adrs/001-ci-cd-and-quality-gates.md` — CI pipeline, pre-commit/pre-push quality gates
- `002-chunker-strategy.md` — Token-aware context building approach
- `003-llm-provider-architecture.md` — LangChain provider facade pattern (addendum: Groq → OpenRouter)
- `004-react-agent-design.md` — ReAct agent design, tool selection, LangChain createAgent (v1.2+)
- `005-true-sse-streaming.md` — AsyncGenerator-based mid-loop SSE streaming
- `006-adaptive-query-decomposition.md` — Retriever prompt decomposition for comparison/temporal queries
- `007-query-id-resilience.md` — Query IDs, stored results, and reconnect/dedup for background tabs
- `008-voxtral-tts.md` — Mistral Voxtral for TTS (why not OpenRouter audio / ElevenLabs)
- `009-pipeline-latency.md` — Latency investigation; LLM writes only judgement, code supplies source metadata; eval SSE timings and `--baseline`
- `010-merged-writer-and-model-speed.md` — Opt-in `PIPELINE_MERGED_WRITER` (−27% mean latency in eval) and OpenRouter model throughput benchmark

## Linear Project

Project: [VoxPopuli](https://linear.app/ai-adventures/project/voxpopuli-3e4f9761d135)
Team: AI Adventures
Issues: AI-99 through AI-165+
