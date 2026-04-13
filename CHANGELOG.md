# Changelog

All notable changes to VoxPopuli are documented in this file.

## [Unreleased]

### Added

- **Homepage UX polish** — Hero gradient with noise texture, masthead rule, editorial timeline component, preview cards matching real answer format, footer CTA, search focus refinements, light theme fixes, and 3x2 numbered example card grid.
- **Fallback agent transition in pipeline UI** — When the pipeline falls back to the legacy single-agent path, the frontend now surfaces the transition visibly instead of silently switching modes.
- **Groq TPM rate-limit handling** — Retry logic for Groq token-per-minute rate limits with user-friendly error messages instead of raw 429 responses.
- **M8: Multi-Agent Pipeline** — Three-stage Retriever-Synthesizer-Writer architecture replacing the single-agent ReAct loop. Structured inter-agent data contracts via Zod schemas (`EvidenceBundle`, `AnalysisResult`, `AgentResponseV2`). (#15)
- **Per-stage failure recovery** in OrchestratorService — Retriever failure falls back to legacy agent, Synthesizer retries once then falls back, Writer retries once then uses `buildFallbackResponse`.
- **Fallback response builder** — Converts AnalysisResult + EvidenceBundle into a minimal AgentResponse when the Writer stage fails after retry.
- **Adaptive query decomposition** — Retriever prompt uses multi-search strategy for broad/comparative queries. ADR-006 documents the design.
- **Dry-well circuit breaker** — Skips compaction LLM call when ReAct loop returns sparse data (<200 chars or no story patterns), saving tokens on topics HN hasn't discussed.
- **LangSmith metadata tags** — All pipeline `.invoke()` calls annotated with `metadata` (pipeline_stage, query) and `tags` for trace filtering.
- **Live elapsed timer** — Frontend shows a ticking seconds counter during SSE query streaming in both pipeline and legacy modes.
- **Mobile background resilience** — SSE retry with exponential backoff, heartbeat monitoring, and visibility-change detection for backgrounded tabs.
- **Pipeline test suite** — 168 tests covering RetrieverNode, SynthesizerNode, WriterNode, and OrchestratorService with unit, edge case, and integration coverage.
- **Eval harness documentation** — README and lessons learned from Mistral eval run.
- **Real-time step streaming** — Retriever tool calls trickle to frontend during ReAct loop via LangGraph `config.writer` (replaces broken `dispatchCustomEvent` path). Steps show human-friendly summaries ("Found 4 stories", "Read 12 comments") instead of raw data. (AI-331)
- **Pipeline token tracking** — `usage_metadata` accumulated across all three pipeline nodes via LangGraph state annotation reducers. Meta bar now shows actual token counts instead of zeros. (AI-331)
- **Source card dates** — `postedDate` extracted from retriever step tool outputs and displayed on source cards. (AI-331)

### Changed

- **Default LLM provider switched from Groq to Mistral** — Mistral Large 3 is now the out-of-the-box provider, offering a better balance of cost and synthesis quality for most queries.
- **Writer input stripped to citation table** — Writer receives `{ analysis, sources }` via Zod-composed `WriterInputSchema` (AnalysisResultSchema + SourceMetadataSchema) instead of full EvidenceBundle, architecturally enforcing the "don't re-analyze" constraint.
- **Synthesizer input formatted as structured text** — `formatBundleForSynthesizer()` converts raw JSON to token-efficient markdown-style text, stripping unused metadata (url, commentCount, tokenCount).
- **Retriever compaction input filtered** — Only tool result and assistant messages passed to compactor; system prompts and initial query removed.
- **Writer prompt updated** — References citation sources table instead of EvidenceBundle.

### Fixed

- **Horizontal scroll eliminated on results page** — Fixed five overflow root causes: source card text wrapping, markdown table overflow, `min-w-0` on flex children, trust indicator mobile sizing, and source card title word-break.
- **Pipeline stage timers stop on stall and error** — Timer caps at 180s, resets on retry, and stall detection prevents indefinitely spinning counters on SSE errors or connection drops.
- **Trust bar all zeros in pipeline mode** — Orchestrator passed empty steps array to `computeTrustMetadata`. Now captures retriever steps (with `toolOutput` for date/ID extraction) and forwards to trust computation. Also fixed recency: chunker now includes `postedDate` from Algolia `created_at` so `search_hn` results feed into recency scoring (previously only `get_story` provided dates). (AI-331)
- **Theme toggle overlapping new-question button** — Extracted toggle into `ng-template`, fixed-position on landing page only, inline in results header. (AI-331)
- **Step streaming broken in pipeline mode** — `dispatchCustomEvent` only works with `.streamEvents()`, not `.stream()` with `streamMode: "custom"`. Switched to `config.writer`. (AI-331)
- **Frontend `story_id` key mismatch** — `summarizeAction` checked `storyId`/`id` but tool schema uses `story_id`, causing "Fetched comments for story #" with missing ID. (AI-331)
- **SSE `as any` cast** replaced with safe type cast for retry field.
- **CORS EventSource error** — `FRONTEND_URL` was unset on Render, defaulting to `localhost:4200`. Cross-origin `EventSource` requests from the production frontend were rejected, causing `"undefined" is not valid JSON`. Set correct production origin in `render.yaml`, added defensive guard for undefined SSE data, and explicit CORS methods/headers. ([fix/cors-eventsource](https://github.com/darth-dodo/voxpopuli/tree/fix/cors-eventsource))

### Refactored

- **Removed `dispatchCustomEvent`** from pipeline nodes — replaced with `config.writer` for `streamMode: "custom"` compatibility.
- **Chunker includes posted dates** — `StoryChunk.postedDate` populated from `HnSearchHit.created_at`, emitted as `Posted: YYYY-MM-DD` in `formatForPrompt`. Used by both trust recency scoring and source card display.

## [0.5.0] — 2026-04-06

### Fixed

- **Production API URL** — Set `apiUrl` in Angular production environment to point at the Render API service. (#11)
- **Timeout graceful degradation** — Agent and SSE streaming now degrade gracefully on LLM provider timeouts instead of surfacing raw errors. (#10)
- **Homepage design regression** — Restored M4 homepage layout with 6-card example grid and dark/light theme toggle. (#9)

## [0.4.0] — 2026-04-05

### Added

- **M7: Deployment & Observability** — Dockerfile (multi-stage build), `render.yaml` (API Docker service + static frontend), Sentry integration, structured logging with `nestjs-pino`, health check endpoint, Codecov badge. (#6)
- **M4: Frontend** — Angular 17+ standalone-component UI with "Data Noir Editorial" design system. Chat page with SSE streaming, agent reasoning timeline, source cards, trust bar, provider selector, meta bar, dark/light theme, `ngx-markdown` answer rendering. (#5)

### Fixed

- **Docker COPY path** — Corrected webpack output path in Dockerfile `COPY --from=build` stage. (#8)
- **Husky in Docker** — Skip `husky prepare` hook during production `pnpm install --prod` via `--ignore-scripts`. (#7)

## [0.3.0] — 2026-04-04

### Added

- **M3: Agent Core** — ReAct agent via LangChain `createAgent` with `search_hn`, `get_story`, `get_comments` tools. Trust metadata computation (source verification, recency, diversity). Partial response builder for graceful LLM failures. AsyncGenerator-based SSE streaming with `thought`/`action`/`observation`/`answer`/`error` event types. System prompt with claim taxonomy. ADR-004 (ReAct agent design), ADR-005 (true SSE streaming). (#4)
- **M2: LLM Provider Stack & Chunker** — `LlmService` facade with Groq, Claude, and Mistral providers implementing `LlmProviderInterface` over LangChain `ChatModel`. `ChunkerService` with token-aware context building (character-based estimation). ADR-002 (chunker strategy), ADR-003 (LLM provider architecture). (#3)
- **Product spec v2.0.0** — LangChain architecture, trust framework, expanded voice output spec. (#2)

## [0.2.0] — 2026-04-03

### Added

- **M1: Scaffold & Data Layer** — Nx monorepo with NestJS 11 backend + Angular frontend + `@voxpopuli/shared-types`. `CacheService` (in-memory via `node-cache`), `HnService` (Algolia search + Firebase item/comment API with retry and backoff), health endpoint, shared TypeScript interfaces. (#1)
- **CI/CD pipeline** — GitHub Actions with lint, test, format checks. Pre-push hooks via Husky + lint-staged. ADR-001 (CI/CD and quality gates).

## [0.1.0] — 2026-03-31

### Added

- **Project inception** — Initial commit, product specification v1.0–v1.2, architecture document with milestone breakdown, CLAUDE.md with project conventions, M1 design document.
