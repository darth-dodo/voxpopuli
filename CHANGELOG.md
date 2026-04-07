# Changelog

All notable changes to VoxPopuli are documented in this file.

## [Unreleased]

### Fixed

- **CORS EventSource error** — `FRONTEND_URL` was unset on Render, defaulting to `localhost:4200`. Cross-origin `EventSource` requests from the production frontend were rejected, causing `"undefined" is not valid JSON`. Set correct production origin in `render.yaml`, added defensive guard for undefined SSE data, and explicit CORS methods/headers. ([fix/cors-eventsource](https://github.com/darth-dodo/voxpopuli/tree/fix/cors-eventsource))

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
