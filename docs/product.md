# VoxPopuli — Product Specification

**Version:** 3.3.0
**Status:** Final Draft
**Last Updated:** October 3, 2026
**Author:** Abhishek Juneja

> _"Vox Populi, Vox Dei."_ -- The voice of the people is the voice of God.

---

## Table of Contents

- [Revision Log](#revision-log)
- [1. What is VoxPopuli?](#1-what-is-voxpopuli)
- [2. Why This Exists](#2-why-this-exists)
  - [The Problem](#the-problem)
  - [The Opportunity](#the-opportunity)
  - [Who Is This For?](#who-is-this-for)
  - [Sample Use Cases (20)](#sample-use-cases-20)
- [3. Core Capabilities](#3-core-capabilities)
  - [3.1 Intelligent Search](#31-intelligent-search)
  - [3.2 Deep Comment Thread Analysis](#32-deep-comment-thread-analysis)
  - [3.3 Multi-Agent Pipeline](#33-multi-agent-pipeline)
  - [3.4 Sourced Answers](#34-sourced-answers)
  - [3.5 Live Reasoning Visualization](#35-live-reasoning-visualization)
  - [3.6 Response Caching](#36-response-caching)
  - [3.7 Rate Limiting](#37-rate-limiting)
  - [3.8 Voice Output (Podcast Mode)](#38-voice-output-podcast-mode)
  - [3.9 Live Answer Draft](#39-live-answer-draft)
  - [3.10 Follow-up Questions](#310-follow-up-questions)
  - [3.11 Honest Confidence on Thin Evidence](#311-honest-confidence-on-thin-evidence)
  - [3.12 Clear Errors for Rejected API Keys](#312-clear-errors-for-rejected-api-keys)
- [4. Architecture](#4-architecture)
  - [4.1 High-Level Overview](#41-high-level-overview)
  - [4.2 Tech Stack](#42-tech-stack)
  - [4.3 Design System: "Data Noir Editorial"](#43-design-system-data-noir-editorial)
  - [4.4 Module Dependency Graph](#44-module-dependency-graph)
- [5. LLM Provider Architecture](#5-llm-provider-architecture)
  - [5.1 Why Triple-Stack?](#51-why-triple-stack)
  - [5.2 Provider Comparison](#52-provider-comparison)
  - [5.3 Provider Interface (LangChain)](#53-provider-interface-langchain)
  - [5.4 Provider Selection](#54-provider-selection)
- [6. Data Flow](#6-data-flow)
  - [6.1 Single Query Lifecycle](#61-single-query-lifecycle)
  - [6.1.1 Multi-Agent Pipeline Flow (v3.0)](#611-multi-agent-pipeline-flow-v30)
  - [6.2 Token Budget Management](#62-token-budget-management)
  - [6.3 Comment Fetching Strategy](#63-comment-fetching-strategy)
- [7. API Specification](#7-api-specification)
  - [7.1 POST /api/rag/query](#71-post-apiragquery)
  - [7.2 GET /api/rag/stream](#72-get-apiragstream)
  - [7.3 POST /api/tts/narrate](#73-post-apittsnarrate)
  - [7.4 GET /api/health](#74-get-apihealth)
  - [7.5 GET /api/health/llm](#75-get-apihealthllm)
- [8. Agent Tool Specifications](#8-agent-tool-specifications)
  - [8.1 search_hn](#81-search_hn)
  - [8.2 get_story](#82-get_story)
  - [8.3 get_comments](#83-get_comments)
- [9. Tool Use Protocol (via LangChain)](#9-tool-use-protocol-via-langchain)
  - [9.1 How Tool Calling Works](#91-how-tool-calling-works)
  - [9.2 What LangChain Handles Per Provider](#92-what-langchain-handles-per-provider)
  - [9.3 Why This Matters](#93-why-this-matters)
  - [9.4 What We Still Own](#94-what-we-still-own)
  - [9.5 Pipeline Configuration (v3.0)](#95-pipeline-configuration-v30)
- [10. Project Structure](#10-project-structure)
- [11. Key Design Decisions](#11-key-design-decisions)
  - [11.1 Why ReAct over simple RAG?](#111-why-react-over-simple-rag)
  - [11.2 Why SSE over WebSockets?](#112-why-sse-over-websockets)
  - [11.3 Why Nx monorepo?](#113-why-nx-monorepo)
  - [11.4 Why triple-stack LLM instead of one?](#114-why-triple-stack-llm-instead-of-one)
  - [11.5 Why not vector embeddings?](#115-why-not-vector-embeddings)
  - [11.6 Why cache in v1?](#116-why-cache-in-v1)
  - [11.7 Why Multi-Agent Pipeline over Single ReAct?](#117-why-multi-agent-pipeline-over-single-react)
  - [11.8 Why Compaction as a Separate Step?](#118-why-compaction-as-a-separate-step)
- [12. Evaluation Harness](#12-evaluation-harness)
  - [12.1 Why?](#121-why)
  - [12.2 Test Query Format](#122-test-query-format)
  - [12.3 Scoring](#123-scoring)
  - [12.4 Running Evals](#124-running-evals)
  - [12.5 Test Suite (27 queries: 20 general + 7 trust)](#125-test-suite-27-queries-20-general--7-trust)
- [13. Trustworthiness Framework](#13-trustworthiness-framework)
  - [13.1 Layer 1: Agent Trustworthiness](#131-layer-1-agent-trustworthiness)
  - [13.2 Layer 2: HN Crowd Trustworthiness](#132-layer-2-hn-crowd-trustworthiness)
  - [13.3 Layer 3: Podcast Rewrite Trustworthiness](#133-layer-3-podcast-rewrite-trustworthiness)
  - [13.4 Trust Pipeline (Runtime)](#134-trust-pipeline-runtime)
  - [13.5 Trust Indicators in the UI](#135-trust-indicators-in-the-ui)
  - [13.6 Trust-Specific Eval Queries](#136-trust-specific-eval-queries)
  - [13.7 New Shared Types](#137-new-shared-types)
  - [13.8 Fact vs Opinion Distinction](#138-fact-vs-opinion-distinction)
  - [13.9 Pipeline Types (v3.0)](#139-pipeline-types-v30)
- [14. Non-Functional Requirements](#14-non-functional-requirements)
  - [14.1 Performance](#141-performance)
  - [14.2 Reliability](#142-reliability)
  - [14.3 Cost](#143-cost)
  - [14.4 Security](#144-security)
- [15. Roadmap](#15-roadmap)
- [16. Success Metrics](#16-success-metrics)
- [17. Getting Started](#17-getting-started)
- [18. Contributing](#18-contributing)
- [19. Voice Output (Mistral Voxtral TTS)](#19-voice-output-mistral-voxtral-tts)
  - [19.1 Overview](#191-overview)
  - [19.2 Pipeline](#192-pipeline)
  - [19.3 Signature Voice](#193-signature-voice)
  - [19.4 API Endpoints](#194-api-endpoints)
  - [19.5 Podcast Rewrite Example](#195-podcast-rewrite-example)
  - [19.6 Frontend: Audio Player](#196-frontend-audio-player)
  - [19.7 New Module](#197-new-module)
  - [19.8 New Dependencies and Config](#198-new-dependencies-and-config)
  - [19.9 Cost Impact](#199-cost-impact)
  - [19.10 Risks](#1910-risks)
- [20. License](#20-license)

---

## Revision Log

| Version | Date       | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.3.0   | 2026-10-03 | Live answer draft streamed while the Writer runs (`token` SSE events); follow-up questions reuse the previous answer's evidence (`followUpOf`); identical questions replayed for 15 min with a "cached" badge; every source dated from the HN API; thin-evidence handling (search filter relaxation, confidence cap, gap note); fail-fast on rejected LLM API keys plus `GET /api/health/llm`; opt-in merged writer (`PIPELINE_MERGED_WRITER`); pipeline latency work (ADR-009); narration fixes for mobile; eval harness scores the pipeline over SSE with current prices; stale limits, cache and API details corrected |
| 3.2.0   | 2026-04-15 | SSE background tab recovery (kill stale subscription, fetch stored result by queryId, reconnect if still running); backend query deduplication; 3-state SSE connection machine (streaming/done/error) replaces 8-state machine; stall timeout raised to 300s; pipeline fallback tracks completed stages and only marks incomplete stages as error; query result endpoint 202 response returns full QueryResult shape with compile-time enforcement; frontend event handling shared between submit() and reconnectStream() via handleStreamEvent()                                                                         |
| 3.1.0   | 2026-04-13 | Pipeline promoted to default mode (frontend always sends useMultiAgent: true); LangGraph StateGraph replaces hand-rolled orchestrator; shared invokeWithRetry utility; default provider changed to mistral; frontend UX hardening (sticky header, cancel, stall detection, background-resilient timer); Data Noir Editorial design system documented                                                                                                                                                                                                                                                                      |
| 3.0.0   | 2026-04-08 | Multi-agent pipeline architecture (Retriever/Synthesizer/Writer); new shared types (EvidenceBundle, AnalysisResult, AgentResponse v2); PipelineConfig with provider-per-agent mapping; SSE PipelineEvent protocol; feature flag for gradual rollout                                                                                                                                                                                                                                                                                                                                                                       |
| 2.0.0   | 2026-04-03 | Version bump; final unified spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1.2.0   | 2026-03-31 | Merged voice addendum; 20 use cases; 3-layer trustworthiness framework; fact vs opinion taxonomy; single unified document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.1.0   | 2026-03-31 | Native tool_result protocol; caching + rate limiting promoted to v1.0; comment cap reduced to 30; eval harness added; latency targets revised; triple-stack LLM provider (Claude + Mistral + Groq)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1.0.0   | 2026-03-31 | Initial draft                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## 1. What is VoxPopuli?

VoxPopuli is an **agentic RAG (Retrieval-Augmented Generation) system** that turns Hacker News into a queryable knowledge base. Ask a question in natural language. The agent searches HN stories, crawls comment threads, reasons about what it finds, and delivers a sourced, synthesized answer -- with full transparency into its reasoning process.

It is not a chatbot wrapper. It is a **multi-agent research pipeline** where specialized agents handle retrieval, synthesis, and composition independently -- each optimized for its cognitive task, with the option of a different LLM provider per stage.

**One-liner:** _"Ask anything. Get the internet's smartest crowd-sourced answer, with receipts."_

---

## 2. Why This Exists

### The Problem

Hacker News has 18+ years of high-signal technical discussion from engineers, founders, researchers, and domain experts. But accessing that knowledge is painful:

- **Algolia search is keyword-only.** No semantic understanding. "Best database for time-series" and "storing sensor data efficiently" return completely different results for the same question.
- **Comments are buried.** The best insights are 3 levels deep in a 400-comment thread. Nobody has time to read all of that.
- **No synthesis.** Even if you find 5 relevant threads, YOU have to be the one connecting the dots across them.
- **No memory.** Every search session starts from zero. There is no continuity.

### The Opportunity

LLMs can now reason over retrieved context. Combine that with HN's structured API and you get something that didn't exist before: an agent that reads HN the way a senior engineer would -- strategically, critically, and across multiple sources -- but in seconds instead of hours.

### Who Is This For?

| Persona                            | Use Case                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| **Engineers** choosing tools       | "What does HN think about Bun vs Deno in 2026?"               |
| **Founders** validating ideas      | "Has anyone built a competitor to X? What was the reception?" |
| **Researchers** tracking discourse | "How has sentiment on LLM agents changed over the past year?" |
| **Job seekers**                    | "What companies is HN excited about hiring at right now?"     |
| **Curious humans**                 | "What's the most controversial HN post about remote work?"    |

### Sample Use Cases (20)

**Engineers Making Decisions:**

1. "Bun vs Deno vs Node for a new backend in 2026" -- Agent searches 3-4 threads, pulls comment opinions from practitioners who actually migrated, synthesizes tradeoffs.
2. "Is Drizzle ORM production-ready?" -- Finds Show HN launch threads, digs into comments about edge cases, surfaces fans and critics.
3. "What database should I use for time-series IoT data?" -- Cross-references threads on TimescaleDB, InfluxDB, QuestDB with benchmarks from comments.
4. "What's the HN consensus on monorepos vs polyrepos at scale?" -- Extracts the strongest arguments from both sides of the recurring holy war.

**Founders and Product People:**

5. "Has anyone built a competitor to Notion? What was the reaction?" -- Surfaces Show HN launches and the brutal honesty HN is known for.
6. "What do developers actually hate about Stripe?" -- Categorizes gripes (pricing, docs, support), notes what Stripe responded to.
7. "Is there demand for an open-source alternative to Figma?" -- Searches Penpot and Figma acquisition threads, gauges sentiment.
8. "What startup ideas has HN consistently said 'someone should build this'?" -- Deep dive into Ask HN threads about missing tools and unmet needs.

**Researchers and Trend Watchers:**

9. "How has HN sentiment on AI agents changed over the past 12 months?" -- Date-sorted search, compares tone of early threads vs recent.
10. "What are the emerging programming languages HN is excited about?" -- Surfaces Zig, Gleam, Roc, Unison mentions, ranks by engagement.
11. "What do HN users think about the future of remote work post-2025?" -- Pulls from multiple heated threads, presents the full spectrum.
12. "Track the HN reaction to every major OpenAI announcement" -- Story-by-story breakdown of community trust over time.

**Job Seekers and Career:**

13. "What companies is HN most positive about working at right now?" -- Surfaces "Who is hiring" threads and comments praising specific teams.
14. "Is it worth learning Rust in 2026 for career purposes?" -- Hiring trends, career advice threads, and Rust adoption stories.
15. "What do senior engineers on HN say about moving into management?" -- Deep comment mining on a question that generates long, personal responses.

**Curiosity and Deep Dives:**

16. "What's the most controversial HN post of all time?" -- Searches by comment count + point ratio, finds the flamewars.
17. "Best books recommended on HN for system design" -- Mines Ask HN book threads, deduplicates, ranks by mention count.
18. "What side projects on Show HN actually turned into real businesses?" -- Cross-references Show HN history with later success stories.
19. "What do HN users think about college degrees in CS?" -- Synthesizes the self-taught vs degree camps.
20. "ELI5 the drama around the Node.js fork to io.js" -- Historical deep dive from original threads.

**The Podcast Angle:** Every use case becomes a listenable 2-3 minute segment with the voice layer. Daily routine: open VoxPopuli, type "What's interesting on HN today?", hit Listen, pour your coffee.

---

## 3. Core Capabilities

### 3.1 Intelligent Search

The agent doesn't just forward your query to Algolia. It **reformulates** the query based on what it's looking for, adjusts filters (date range, minimum points, tags), and may run multiple searches to triangulate an answer.

**Example:**

```
User: "Is SQLite good enough for production web apps?"

Agent internally:
  Step 1: search_hn("SQLite production web app", min_points: 50)
  Step 2: search_hn("SQLite scaling limitations", sort: date)
  Step 3: get_comments(story_id: 38543832)  // highest-signal thread
  Step 4: Synthesize answer from 3 sources + 28 comments
```

**Filter relaxation:** Models often pick `min_points` thresholds (50-100) that leave zero or one result on niche topics. If a points-filtered search returns fewer than 3 stories (`MIN_FILTERED_HITS`), `search_hn` retries once without the filter and tells the agent it did so. If dropping the filter finds nothing more, the agent is told not to repeat the search.

### 3.2 Deep Comment Thread Analysis

Comments are where the real knowledge lives. The agent:

- Fetches comment trees up to 3 levels deep. (The `get_comments` tool accepts `max_depth` up to 5, but the fetcher stops at 3 levels.)
- Fetches one depth level at a time, with every parent's replies requested in parallel, so a tree costs one round-trip per level instead of one per comment.
- Strips HTML, preserves code blocks.
- Prioritizes shallow (high-visibility) comments first.
- **Hard cap: 30 comments per story** to control latency and token budget.

**Why 30, not 50 or 100?** Each Firebase comment fetch is an individual HTTP call. A 400-comment thread means 400 requests. At 30 comments (top-level + high-signal nested), we get the best signal-to-noise ratio while keeping comment fetch time under 3 seconds. The agent can always fetch comments from multiple stories if it needs broader coverage.

### 3.3 Multi-Agent Pipeline

**New in v3.0.** The single ReAct agent is replaced by a three-stage pipeline, each stage optimized for one cognitive task.

```
┌─────────────┐    EvidenceBundle    ┌──────────────┐    Analysis    ┌─────────────┐
│  RETRIEVER  │ ──────────────────▶  │  SYNTHESIZER │ ────────────▶ │   WRITER    │
│  (ReAct)    │                      │ (single-pass)│               │(single-pass)│
│             │                      │              │               │             │
│ Search HN   │                      │ Find patterns│               │ Craft prose │
│ Fetch data  │                      │ Spot conflict│               │ Add structure│
│ COMPACT     │                      │ Rate signal  │               │ Cite sources │
└─────────────┘                      └──────────────┘               └─────────────┘
       ▲                                                                   │
       │                        ┌──────────────┐                           │
       └─────────────────────── │ ORCHESTRATOR │ ◀─────────────────────────┘
                                └──────────────┘
```

**Why three agents:**

| Agent       | Needs tools?                             | Needs iteration?                   | Pattern                           |
| ----------- | ---------------------------------------- | ---------------------------------- | --------------------------------- |
| Retriever   | Yes (search_hn, get_story, get_comments) | Yes (may need follow-up searches)  | **ReAct loop**                    |
| Synthesizer | No (reasons over the bundle)             | No (one pass over structured data) | **Single-pass structured output** |
| Writer      | No (composes from analysis)              | No (one pass to compose prose)     | **Single-pass structured output** |

The Retriever collects raw HN data and **compacts** it into themed evidence groups (~600 tokens from 30+ comments). The Synthesizer extracts 3-5 insights ranked by evidence strength. The Writer turns structured analysis into readable prose with citations. No raw HN data crosses the Retriever boundary.

**Sources come from code, not the model.** The tools record every story they surface (title, author, points, comment count, URL and posted date, straight from the HN API) in a per-request source registry. The compactor writes only themes and the Writer writes only prose; the source table on every answer is attached from the registry. This is faster (the model no longer transcribes metadata) and removes invented or missing source fields. See ADR-009.

**Latency guards (ADR-009):** The Retriever's ReAct turns are capped at 768 output tokens. If the Retriever exhausts its tool budget, it compacts what it has already collected instead of failing the run.

**Provider allocation:**

By default, all three agents use the **globally selected provider** (the `LLM_PROVIDER` env var or the UI provider selector). This keeps behavior consistent with the single-agent path and avoids requiring multiple API keys.

| Agent       | Default Provider        | `optimized` Preset Provider            | Why (optimized)                                                  |
| ----------- | ----------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| Retriever   | Global (`LLM_PROVIDER`) | **OpenRouter** (Qwen3 235B A22B)       | Speed and price. Multiple tool calls need fast, cheap inference. |
| Synthesizer | Global (`LLM_PROVIDER`) | **Claude** (claude-haiku-4-5-20251001) | Reasoning depth. Pattern extraction needs the strongest model.   |
| Writer      | Global (`LLM_PROVIDER`) | **Mistral** (mistral-small-latest)     | Cost-optimized. Structured prose from structured input.          |

`PipelineConfig.providerMap` can name a provider per stage. When it is omitted, every stage uses the global `LLM_PROVIDER`. The API endpoints take a single `provider` and apply it to all three stages, so per-stage splits are not reachable over HTTP today.

_The preset profiles (`optimized`, `speed`, `cost`) in the table above are a design proposal and are not implemented (October 2026)._

**Default mode:** The pipeline is the default execution path. The frontend always passes `useMultiAgent: true`. The `PipelineConfig.useMultiAgent` flag remains available for per-request toggling, but normal usage always runs the pipeline.

**Orchestration:** The pipeline is coordinated by a LangGraph `StateGraph` (not a hand-rolled orchestrator). The graph declares a typed `PipelineAnnotation` that tracks query, evidence bundle, analysis result, response, steps, and cumulative token usage across nodes. Stage transitions emit SSE `PipelineEvent`s to the frontend.

**Retry logic:** All three pipeline nodes share an `invokeWithRetry` utility that handles transient LLM failures (including TPM rate limit errors) with exponential backoff. On JSON parse failure, the Synthesizer and Writer retry with an instruction to respond with the complete JSON object only. A failed Synthesizer is retried once; a failed Writer is retried once and then falls back to an answer built from the analysis. Compaction output is parsed leniently: unknown claim types become `opinion`, relevance is clamped, at most 6 themes are kept, and themes written before a JSON syntax error are salvaged. The legacy fallback runs only when nothing usable comes back.

**Legacy compatibility:** The original ReAct agent remains available as a fallback. The Orchestrator's `runWithFallback()` method catches multi-agent pipeline errors and automatically degrades to the single-agent path, on the same provider the user chose. When a fallback occurs, the method tracks which pipeline stages completed successfully and only marks the remaining incomplete stages with an error status, avoiding contradictory done-then-error sequences in the SSE event stream. A rejected API key skips the fallback (see 3.12).

**Merged writer mode (opt-in, ADR-010):** With `PIPELINE_MERGED_WRITER=true`, the Synthesizer makes no LLM call and the Writer analyzes the evidence directly. The UI still shows three stages; the Synthesizer completes instantly as "Merged into writer". On one 25-query Mistral eval run it cut mean latency by 27% with no lower quality score. It is off by default until a second run confirms the result.

### 3.4 Sourced Answers

Every claim in the agent's response traces back to a specific HN story or comment. The response includes:

- Story title, author, and point count
- The date the story was posted, taken from the HN API and shown on the source card
- Direct links to HN threads
- Commenter usernames for attributed opinions

No hallucination. If the agent can't find it, it says so.

### 3.5 Live Reasoning Visualization

The frontend streams the agent's thinking process in real time via Server-Sent Events (SSE). Users see:

- Each reasoning step as it happens (pipeline stages with per-stage elapsed counters)
- Which tools are being called and why
- Expandable raw results, with a count of the comments each fetch actually returned
- A live draft of the answer while the Writer composes it (see 3.9)
- The final answer with source cards
- A cancel button to abort the active stream (preserving already-collected steps and events)

**UX hardening:** The frontend includes a sticky header with query display during streaming, a background-resilient elapsed timer that uses wall-clock comparison (so it stays accurate even if the browser tab is backgrounded), and a 300-second stall detection watchdog in RagService that surfaces a user-friendly error when the server stops responding. The SSE connection state machine uses three states -- streaming, done, and error -- replacing the earlier eight-state model. When the browser tab is backgrounded during a stream, the frontend recovers gracefully on return: it kills the stale SSE subscription, fetches the stored result by queryId from the backend, and reconnects to the SSE stream if the query is still running. Backend query deduplication prevents duplicate agent runs when a client reconnects to an in-flight query. Event handling logic is shared between the initial submit and the reconnection path via a single handleStreamEvent method, eliminating duplicated parsing code in the frontend.

This isn't just a UX feature. It's a trust mechanism.

### 3.6 Response Caching

**Promoted from v1.1 to v1.0 scope.**

Every query hits both external APIs and the LLM. Without caching, identical queries burn tokens and latency for no reason. v1.0 ships with a two-layer cache. Both layers live in `CacheService`, an in-memory `lru-cache` wrapper (5,000 entries max, per-key TTL).

**Layer 1: HN Data Cache (in-memory)**

| Data                      | TTL        | Reason                                         |
| ------------------------- | ---------- | ---------------------------------------------- |
| Algolia search results    | 15 minutes | Stories don't change fast, but new ones appear |
| Firebase items (stories)  | 1 hour     | Story metadata is stable                       |
| Firebase items (comments) | 30 minutes | Comments are semi-stable, but new ones arrive  |

**Layer 2: Query Result Cache**

| Data                                                       | TTL                                               | Reason                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Completed answer replayed to identical streaming questions | 15 minutes                                        | Popular questions (e.g. the homepage examples) cost one pipeline run per window |
| Full AgentResponse for `POST /api/rag/query`               | 10 minutes                                        | Identical blocking requests get instant results                                 |
| Stored query result (`/api/rag/query/:id/result`)          | 5 minutes while running, 15 minutes once complete | Background-tab recovery and reconnects                                          |
| Evidence from a finished pipeline run (for follow-ups)     | 30 minutes                                        | Follow-up questions reuse it instead of searching HN again                      |

**Instant replay of repeated questions:** On the streaming endpoint, a question that matches one still running attaches to that run instead of starting a duplicate. A question that matches one completed in the last 15 minutes is replayed immediately, and its answer carries `meta.cached: true`, which the meta bar shows as a "cached" badge. Matching ignores case and extra whitespace, and is keyed by provider and mode (pipeline, legacy, or a follow-up to a specific answer), so a follow-up never replays an unrelated answer. Failed runs are never replayed.

Cache is invalidated on TTL expiry (or LRU eviction) only; there is no manual invalidation.

### 3.7 Rate Limiting

**Promoted from v1.1 to v1.0 scope.**

The API is rate-limited from day one to prevent accidental cost blowouts and abuse.

| Scope                     | Limit              | Implementation                                       |
| ------------------------- | ------------------ | ---------------------------------------------------- |
| Global query rate         | 60 requests/minute | In-memory sliding window in `RagController`          |
| Global narration rate     | 60 requests/minute | Separate in-memory sliding window in `TtsController` |
| Max concurrent agent runs | 5                  | Semaphore in AgentService                            |

_The per-IP limit (10 requests/minute via `express-rate-limit`) in the original spec is not in the current code; only the global limits above exist._

### 3.8 Voice Output (Podcast Mode)

**New in v1.2.**

VoxPopuli can read its answers aloud using Mistral Voxtral TTS. The name means "voice of the people" -- it should literally have a voice.

**How it works:**

1. Agent finishes and returns a text answer.
2. User clicks the **Listen** button on the answer bubble.
3. Backend rewrites the answer into a **podcast-style script** (conversational tone, no markdown, no raw URLs, natural transitions).
4. Backend sends the script to the Mistral Voxtral speech endpoint (`POST https://api.mistral.ai/v1/audio/speech`). The response is non-streaming JSON with the full MP3 as base64 (`audio_data`), which the backend decodes to a buffer.
5. Backend returns the complete MP3 in a single response; the frontend plays it through an `<audio>` element.

**Podcast Script Rewriting:**

Raw agent output is optimized for reading, not listening. Before TTS, a lightweight LLM call rewrites it:

```
INPUT (agent answer):
"Based on HN discussions, Tailwind v4 has been well-received.
[Story 39482731] by @dhh (423 points) praises the new..."

OUTPUT (podcast script):
"So here's what the Hacker News crowd thinks about Tailwind v4.
The reception has been largely positive. One highly upvoted post
by DHH, with over 400 points, praised the new oxide engine..."
```

Rules for the rewrite:

- Strip all markdown formatting, links, and brackets.
- Convert usernames to spoken form ("at DHH" becomes "DHH").
- Replace "Story 39482731" with natural references ("one popular thread").
- Add conversational transitions ("So here's the thing...", "Now interestingly...").
- Keep it concise. Target 60-90 seconds of audio (roughly 800-1200 characters).
- Preserve all factual claims and attributions.

**Signature Voice:**

VoxPopuli uses a single, fixed narrator voice. This gives the project a recognizable identity, like a podcast host. TTS reuses the Mistral key already used for the LLM; the model and voice are configured in `.env`:

```env
MISTRAL_API_KEY=...                            # Shared with the Mistral LLM provider
MISTRAL_TTS_MODEL=voxtral-mini-tts-latest      # Default
MISTRAL_TTS_VOICE=en_paul_neutral              # Default: preset "Paul - Neutral"
```

The default voice, `en_paul_neutral` ("Paul - Neutral"), is a relaxed, balanced, neutral US English voice. The target character: clear, authoritative but not stiff, slightly conversational. Think "tech podcast host who respects your time."

**Voxtral TTS at a glance:**

| Property      | Value                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Model         | `voxtral-mini-tts-latest`                                                                          |
| Preset voices | 30 (e.g. `en_paul_*`, `gb_oliver_*`, `gb_jane_*`, `fr_marie_*`), listed via `GET /v1/audio/voices` |
| Custom voices | Zero-shot cloning from a 2-3 s sample; referenced by UUID                                          |
| Languages     | 9                                                                                                  |
| Output        | MP3, 22.05 kHz mono, returned as base64 in a JSON body (non-streaming)                             |

**Measured performance:**

| Input                                                 | Audio length | MP3 size | Generation time |
| ----------------------------------------------------- | ------------ | -------- | --------------- |
| Short line                                            | --           | --       | ~0.6 s          |
| 2,500-char script (max rewrite length)                | ~108 s       | ~960 KB  | ~10 s           |
| Full `/api/tts/narrate` (short answer, incl. rewrite) | --           | --       | ~4 s            |

**Cost per voiced answer:** One small LLM rewrite call plus Voxtral usage for the script characters, billed per [Mistral pricing](https://mistral.ai/pricing).

**Mobile playback:** Voxtral returns variable-bitrate MP3 without a Xing header, so browsers misjudged the duration and iOS Safari cut narration off early. The backend now adds a Xing header (`addXingHeader()` in `apps/api/src/tts/mp3-xing.ts`) before returning the MP3, and the audio player unlocks its audio element inside the Listen tap so iOS allows playback once the file arrives.

### 3.9 Live Answer Draft

**New in v3.3.** Users no longer stare at a spinner while the Writer works. The Writer streams its first attempt, and the backend renders the partial output as markdown and sends it as `token` SSE events (append-only deltas). The UI shows it in a "Drafting answer…" card. When the final `answer` event arrives, it replaces the draft. The draft and the final answer are rendered by the same function, so they cannot drift apart. A Writer retry does not stream a second draft.

### 3.10 Follow-up Questions

**New in v3.3.** Under a finished pipeline answer, an "Ask a follow-up using these sources" box lets the user ask a related question. The follow-up skips the HN search: the Retriever stage returns the previous answer's evidence (kept for 30 minutes), and the Synthesizer and Writer answer the new question from it. The timeline shows "Reusing N sources from ..." for the Retriever stage. If the earlier evidence has expired, the follow-up runs as a fresh query. Over the API this is `GET /api/rag/stream?followUpOf=<queryId>`.

Follow-ups are single-step: each one reuses the evidence of the answer it was asked under. There is no multi-turn conversation memory.

### 3.11 Honest Confidence on Thin Evidence

**New in v3.3.** When HN has little to say on a topic, the answer says so instead of sounding sure:

- **Search filter relaxation:** points-filtered searches that return fewer than 3 stories are retried without the filter (see 3.1).
- **Confidence cap:** with fewer than 3 sources, the answer's confidence is capped (0-1 sources: low; 2 sources: medium).
- **Gap note:** the answer gains a gap such as "Only 2 Hacker News stories were found on this topic, so these views may not be representative," or, with no sources, a note that the answer is not grounded in HN discussion.

### 3.12 Clear Errors for Rejected API Keys

**New in v3.3.** If an LLM provider rejects its API key, the query fails at once with a message that names the environment variable to fix (for example, "The mistral API key was rejected. Check MISTRAL_API_KEY in the server environment."). Before this change, the Mistral client retried for about two minutes and then the pipeline fell back to the legacy agent, which failed the same way. Now the Mistral client no longer retries client errors (other than 408 and 429), and an auth error from any provider skips the legacy fallback.

Operators can check the active provider's key before users hit it with `GET /api/health/llm` (see 7.5).

---

## 4. Architecture

### 4.1 High-Level Overview

```
+---------------------------------------------------------+
|                   Angular (web)                          |
|                                                          |
|  +---------+  +--------------+  +----------------+      |
|  | Chat UI |  | Agent Steps  |  | Source Cards    |     |
|  |         |  | (pipeline    |  |                 |     |
|  |  [Listen]  |  timeline)   |  | Trust Bar       |     |
|  |  Audio     |              |  |                 |     |
|  |  Player    |              |  |                 |     |
+--+----+-------+------+-------+--+-------+--------+-----+
        |              |                  |
        +--------------+------------------+
                       | SSE (PipelineEvent) / HTTP / Audio
+----------------------+--------------------------------------+
|                   NestJS (api)                               |
|                                                              |
|  +------------------------------------------------------+   |
|  |              RAG Controller                           |   |
|  |   POST /api/rag/query    (full response)              |   |
|  |   GET  /api/rag/stream   (SSE streaming)              |   |
|  |   POST /api/tts/narrate  (MP3 audio)                  |   |
|  +---------------------------+---------------------------+   |
|                              |                               |
|  +---------------------------+---------------------------+   |
|  |           Orchestrator Service                        |   |
|  |   PipelineConfig → Retriever → Synthesizer → Writer   |   |
|  |   SSE events at each stage transition                 |   |
|  |   Fallback to legacy ReAct on error                   |   |
|  +--------------------------------------------------------+  |
|        |                |                |                    |
|  +-----+------+  +------+-------+  +-----+------+           |
|  | Retriever  |  | Synthesizer  |  |   Writer   |           |
|  | (ReAct +   |  | (single-pass |  |(single-pass|           |
|  |  Compactor)|  |  analysis)   |  |  prose)    |           |
|  +-----+------+  +------+-------+  +-----+------+           |
|        |                |                |                    |
|     +--+---+        +---+---+        +---+---+               |
|     |HN API|        | LLM   |        | LLM   |              |
|     |+Cache|        |Service |        |Service |              |
|     +--+---+        +--+----+        +--+----+               |
|        |               |                |                     |
|     Algolia     Claude/OpenRouter Mistral/OpenRouter         |
|     Firebase       (provider       (provider                  |
|                    per stage)       per stage)                 |
+------+------------------------------------------------------+
```

### 4.2 Tech Stack

| Layer                    | Technology                                     | Why                                                             |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------------- |
| **Monorepo**             | Nx                                             | Shared types, unified builds, dependency graph                  |
| **Backend**              | NestJS (Node.js)                               | Modular DI, first-class TypeScript, SSE support                 |
| **Frontend**             | Angular 21                                     | Standalone components, signals, SSE via EventSource             |
| **LLM (production)**     | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Best synthesis quality, 200k context                            |
| **LLM (cost-optimized)** | Mistral Small 4 (`mistral-small-latest`)       | 262k context; default provider; see mistral.ai/pricing          |
| **LLM (speed/dev)**      | OpenRouter (Qwen3 235B A22B)                   | Lowest per-token price, 128k context, throughput-sorted routing |
| **Voice (TTS)**          | Mistral Voxtral (`voxtral-mini-tts-latest`)    | Reuses the Mistral key, no extra SDK, MP3 narration             |
| **Caching**              | lru-cache (in-memory)                          | Zero-infrastructure, sufficient for single-node v1              |
| **Shared Types**         | TypeScript library                             | Single source of truth for API contracts                        |
| **Data Sources**         | HN Algolia + Firebase APIs                     | Full-text search + structured item/comment data                 |

### 4.3 Design System: "Data Noir Editorial"

The frontend uses a custom design system built on Tailwind CSS v4 with CSS-first `@theme` configuration (no `tailwind.config.js`). The visual identity is defined by:

- **Palette:** Deep navy (`#020617`) base, amber accent (`#F59E0B`) for interactive elements and highlights, verification green (`#22C55E`) for trust indicators. Warm amber glow shadows on focus/hover.
- **Homepage:** Noise texture background, amber gradient hero section with the tagline and search input, editorial timeline showing sample queries, and a preview card that matches the real answer view. The landing state and results state share the same component (`ChatComponent`), with the hero collapsing into a sticky header when a query is active.
- **Light/dark theme:** CSS custom property overrides via `.light` class on `<html>`. Dark is the default.
- **Typography:** System font stack with monospace for metadata. Markdown rendered via `ngx-markdown`.
- **Component tokens:** Utility classes (`vp-card`, `vp-prose`, `vp-badge`) provide consistent elevation, border radius, and spacing.

### 4.4 Module Dependency Graph

```
AppModule
+-- ConfigModule (global)
+-- CacheModule
|   +-- CacheService (lru-cache wrapper, TTL management)
|   +-- QueryStore (query results, replay/dedup index, follow-up evidence)
+-- HnModule
|   +-- HnService
|       +-- Algolia HTTP client (search, search_by_date)
|       +-- Firebase HTTP client (getItem, getCommentTree, getTopStoryIds)
|       +-- CacheService (injected, wraps all external calls)
+-- ChunkerModule
|   +-- ChunkerService
|       +-- chunkStories()     -> StoryChunk[]
|       +-- chunkComments()    -> CommentChunk[]
|       +-- buildContext()     -> ContextWindow (token-budgeted)
|       +-- formatForPrompt()  -> string
+-- LlmModule
|   +-- LlmProviderInterface (abstract)
|   +-- ClaudeProvider (implements LlmProviderInterface)
|   +-- MistralProvider (implements LlmProviderInterface)
|   +-- OpenRouterProvider (implements LlmProviderInterface)
|   +-- LlmService (facade, delegates to active provider; getModel(provider, { maxTokens }))
|   +-- llm-errors (isAuthError, LlmAuthError, failFastOnClientError)
+-- AgentModule
|   +-- AgentService
|       +-- run()          -> AgentResponse
|       +-- executeTool()  -> tool results
|       +-- imports: HnModule, ChunkerModule, LlmModule
|   +-- RetrieverAgent (ReAct loop + compaction)
|   +-- SynthesizerAgent (single-pass analysis)
|   +-- WriterAgent (single-pass prose)
|   +-- OrchestratorService (pipeline coordination)
+-- RagModule
|   +-- RagController
|       +-- POST /api/rag/query
|       +-- GET  /api/rag/stream (SSE)
|       +-- GET  /api/rag/query/:id/result
|       +-- imports: AgentModule
+-- HealthModule
|   +-- HealthController
|       +-- GET /api/health
|       +-- GET /api/health/llm (live provider probe, cached 60 s)
+-- TtsModule
    +-- TtsService (Mistral Voxtral via native fetch + podcast rewrite via LlmService)
    +-- TtsController
        +-- POST /api/tts/narrate
        +-- GET  /api/tts/voices
        +-- imports: LlmModule
```

---

## 5. LLM Provider Architecture

### 5.1 Why Triple-Stack?

No single LLM wins on every axis. Different stages of the project need different things:

| Stage                      | Best Provider         | Why                                                    |
| -------------------------- | --------------------- | ------------------------------------------------------ |
| **Development**            | OpenRouter (Qwen3)    | Lowest per-token price, throughput-sorted routing      |
| **Testing/CI**             | OpenRouter or Mistral | Cheap, fast, good enough for regression detection      |
| **Cost-optimized prod**    | Mistral Small 4       | Best quality-per-dollar, 262k context                  |
| **Quality-optimized prod** | Claude (Haiku 4.5)    | Best multi-source synthesis, strongest agent reasoning |

**Long-term direction:** route every provider through OpenRouter, so a single key and a single OpenAI-compatible client cover all models.

### 5.2 Provider Comparison

| Factor                | Claude (Haiku 4.5)          | Mistral Small 4             | OpenRouter (Qwen3 235B A22B 2507)                          |
| --------------------- | --------------------------- | --------------------------- | ---------------------------------------------------------- |
| **Context window**    | 200k                        | 262k                        | 128k (model supports 262k; some hosts cap at 128k)         |
| **Output speed**      | ~50 t/s                     | ~80 t/s                     | Varies by upstream; routed with `sort: throughput`         |
| **Input pricing**     | $1.00/M                     | $0.15/M                     | ~$0.087/M                                                  |
| **Output pricing**    | $5.00/M                     | $0.60/M                     | ~$0.35/M                                                   |
| **Est. cost/query**   | $0.02-0.08                  | $0.003-0.015                | Not yet measured                                           |
| **Model ID**          | `claude-haiku-4-5-20251001` | `mistral-small-latest`      | `qwen/qwen3-235b-a22b-2507` (override: `OPENROUTER_MODEL`) |
| **Tool calling**      | Native (tool_use blocks)    | Native (OpenAI-compatible)  | Native (OpenAI-compatible)                                 |
| **Free tier**         | No                          | Limited                     | No (pay-as-you-go)                                         |
| **Synthesis quality** | Excellent                   | Strong                      | Not yet evaluated                                          |
| **Agent reasoning**   | Excellent                   | Strong                      | Not yet evaluated                                          |
| **API format**        | Anthropic SDK               | Mistral SDK / OpenAI-compat | OpenAI-compatible (`ChatOpenAI` + OpenRouter base URL)     |

_Prices are the per-million-token rates the eval harness uses (checked 2026-09-28). The cost-per-query estimates predate those prices and have not been re-measured._

### 5.3 Provider Interface (LangChain)

VoxPopuli uses **LangChain.js** as the LLM abstraction layer. Each provider is a thin wrapper around LangChain's `BaseChatModel`, which handles tool protocols, message formatting, and provider-specific serialization internally.

**Why LangChain.js over hand-rolled providers or Vercel AI SDK:**

| Option            | Pros                                                                                             | Cons                                                                                    | Decision                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **LangChain.js**  | Handles all tool protocols natively, battle-tested agent primitives, unified ChatModel interface | Extra dependency (~200KB), version coupling                                             | **Chosen.** Eliminates ~500 lines of hand-rolled tool protocol code. |
| **Hand-rolled**   | Zero dependencies, full control                                                                  | Must maintain 3 different tool_result protocols, message formats, and streaming parsers | Rejected. Too much plumbing for a solo dev.                          |
| **Vercel AI SDK** | Good streaming support                                                                           | Weaker agent/tool primitives, less mature tool calling                                  | Rejected. LangChain's agent support is more complete.                |

**Provider interface:**

```typescript
/** Per-call-site model tuning. */
export interface ModelOptions {
  /** Hard cap on generated tokens (output tokens dominate latency). */
  maxTokens?: number;
}

export interface LlmProviderInterface {
  /** Provider identifier, e.g. "openrouter", "claude", "mistral" */
  readonly name: string;

  /** Total context window size in tokens for this provider's model */
  readonly maxContextTokens: number;

  /** Return the LangChain ChatModel instance for this provider (cached per options). */
  getModel(options?: ModelOptions): BaseChatModel;
}
```

Call sites that need only short output pass a cap through `LlmService.getModel(provider, { maxTokens })`. The pipeline Retriever's ReAct turns use 768; the `/api/health/llm` probe uses 5.

**What LangChain handles (we don't touch):**

- Native tool_use / tool_result content blocks (Claude)
- OpenAI-compatible tool role messages (Mistral, OpenRouter)
- Message serialization per provider
- Streaming token delivery
- Tool call parsing from model responses

**What we own:**

- Provider instantiation and API key configuration
- Token budget management (ChunkerService)
- Caching layer (CacheService)
- SSE streaming to the frontend (RagController)
- Tool definitions (LangChain `tool()` helper with Zod schemas)
- Failing fast on rejected API keys (`apps/api/src/llm/llm-errors.ts`)

**Provider implementations:**

| Provider       | LangChain Class                                         | Package                | Config                                               |
| -------------- | ------------------------------------------------------- | ---------------------- | ---------------------------------------------------- |
| **Claude**     | `ChatAnthropic`                                         | `@langchain/anthropic` | `ANTHROPIC_API_KEY`                                  |
| **Mistral**    | `ChatMistralAI` (subclassed as `FailFastChatMistralAI`) | `@langchain/mistralai` | `MISTRAL_API_KEY`                                    |
| **OpenRouter** | `ChatOpenAI` (baseURL `https://openrouter.ai/api/v1`)   | `@langchain/openai`    | `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`) |

The OpenRouter provider defaults to `qwen/qwen3-235b-a22b-2507`, sends `max_tokens: 8192` unless a call site sets a lower cap, and passes OpenRouter provider routing `{ sort: 'throughput' }`. The frontend provider selector labels it "Qwen3".

The Mistral provider subclasses `ChatMistralAI` because the Mistral SDK reports HTTP status as `statusCode`, which LangChain's retry logic ignores; without the subclass a rejected key was retried for about two minutes. `FailFastChatMistralAI` stops retrying on client errors other than 408 and 429.

Source: [LangChain.js ChatModels](https://js.langchain.com/docs/integrations/chat/), [LangChain.js Tool Calling](https://js.langchain.com/docs/how_to/tool_calling/)

### 5.4 Provider Selection

Configured via `.env`:

```env
# Options: openrouter, claude, mistral
LLM_PROVIDER=mistral

# Provider-specific keys (only the active provider's key is required)
ANTHROPIC_API_KEY=sk-ant-...
MISTRAL_API_KEY=...          # Also used for Voxtral TTS
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=qwen/qwen3-235b-a22b-2507   # Optional override

# Pipeline
PIPELINE_MERGED_WRITER=false   # true = skip the Synthesizer's LLM call (ADR-010)
```

The `LlmModule` reads `LLM_PROVIDER` at startup and instantiates the correct provider. Switching providers requires zero code changes. Users can also override per-request via the `provider` query parameter.

---

## 6. Data Flow

### 6.1 Single Query Lifecycle

```
1. User types: "What does HN think about Tailwind v4?"
                    |
2. Angular sends:   POST /api/rag/query
                    |             OR
                    GET /api/rag/stream?query=...  (SSE)
                    |
3. RagController receives request
   +-- Rate limiter checks (60 req/min, global)
   +-- Query cache check (hit? return cached AgentResponse)
                    |
4. AgentService.run() starts the ReAct loop:
   |
   +-- Step 1: LLM decides -> search_hn("Tailwind v4")
   |  +-- CacheService check (miss -> Algolia API -> cache result)
   |  +-- HnService.search() -> 10 hits
   |  +-- ChunkerService.chunkStories() -> StoryChunk[]
   |  +-- Build native tool_result message for provider
   |  +-- Feed back to LLM
   |
   +-- Step 2: LLM decides -> get_comments(story_id: 39482731)
   |  +-- CacheService check per item (mix of hits/misses)
   |  +-- HnService.getCommentTree() -> 30 comments (capped)
   |  +-- ChunkerService.chunkComments() -> CommentChunk[]
   |  +-- Build native tool_result message for provider
   |  +-- Feed back to LLM
   |
   +-- Step 3: LLM decides -> search_hn("Tailwind CSS criticisms")
   |  +-- (same flow as Step 1)
   |
   +-- Step 4: LLM has enough -> generates final answer
                    |
5. AgentResponse returned + cached (TTL: 10 min):
   {
     answer: "HN is broadly positive on Tailwind v4, with...",
     steps: [ ...4 reasoning steps... ],
     sources: [ ...deduplicated story list... ],
     meta: { provider: "mistral", totalTokens: 24500, durationMs: 6200 }
   }
                    |
6. Angular renders:
   +-- Agent steps timeline (expandable)
   +-- Answer text with inline citations
   +-- Source cards with links to HN threads
   +-- Meta bar: provider used, tokens consumed, time taken
```

### 6.1.1 Multi-Agent Pipeline Flow (v3.0)

When `useMultiAgent: true` (default -- frontend always sends this):

```
1. User types: "What does HN think about Tailwind v4?"
                    |
2. Angular sends:   GET /api/rag/stream?query=...&useMultiAgent=true  (SSE)
                    [&followUpOf=<queryId> for a follow-up question]
                    |
3. RagController
   +-- Rate limiter checks (60 req/min, global)
   +-- Same question running? attach to it. Completed in the last 15 min? replay it
   |   at once with meta.cached = true (see 3.6)
   +-- Otherwise → OrchestratorService.runWithFallback(query, config, priorEvidence?)
   |   SSE: init { queryId }
   LangGraph StateGraph compiled and streamed through three nodes
                    |
4. Stage 1: RETRIEVER (ReAct loop, global provider -- mistral by default)
   |  (follow-up: skipped; returns the earlier answer's stored evidence)
   |  +-- search_hn("Tailwind v4") → 10 hits        (tools record each story's metadata
   |  +-- get_comments(39482731) → 30 comments        in the per-request source registry)
   |  +-- search_hn("Tailwind CSS criticisms") → 8 hits
   |  +-- RETRIEVAL_COMPLETE (or tool budget exhausted → compact what was collected)
   |  +-- Compaction LLM call via invokeWithRetry: 30+ raw items → 4 ThemeGroups (~600 tokens)
   |  +-- Source table attached from the registry, not written by the model
   |  → SSE pipeline: { stage: 'retriever', status: 'done', detail: '4 themes from 12 sources' }
                    |
5. Stage 2: SYNTHESIZER (single-pass via invokeWithRetry, global provider)
   |  (merged writer mode: no LLM call, completes instantly)
   |  +-- Receives EvidenceBundle (4 themes, ~600 tokens)
   |  +-- Extracts 3 insights, 1 contradiction, confidence: high
   |  +-- Evidence floor: < 3 sources caps confidence and adds a gap note
   |  → SSE pipeline: { stage: 'synthesizer', status: 'done', detail: '3 insights, confidence: high' }
                    |
6. Stage 3: WRITER (single-pass via invokeWithRetry, global provider)
   |  +-- Receives AnalysisResult (merged mode: the evidence itself)
   |  +-- Composes headline, context, 3 sections, bottom line
   |  +-- First attempt streams as a live draft → SSE token { content } (append-only)
   |  → SSE pipeline: { stage: 'writer', status: 'done', detail: '3 sections, 12 sources' }
                    |
7. SSE answer: { answer, sources (each with postedDate), trust, meta }
   The final answer replaces the draft. Result and evidence are stored for
   replay (15 min) and follow-ups (30 min).
```

### 6.2 Token Budget Management

The Chunker enforces a strict token budget. The budget varies by provider:

```
Claude context:     200,000 tokens -> budget: 80,000 (conservative)
Mistral context:    262,000 tokens -> budget: 100,000
OpenRouter context: 128,000 tokens (Qwen3 supports 262k; some OpenRouter hosts cap at 128k)

Reserved (all providers):
  System prompt:      2,000 tokens
  Agent reasoning:    2,000 tokens
  Per-step overhead:    500 tokens x max_steps

Priority order:
  1. Story metadata (title, author, points)  -- always included
  2. Story text (Ask HN / Show HN bodies)    -- included if fits
  3. Top-level comments (depth 1)            -- highest priority
  4. Nested comments (depth 2-3)             -- if budget remains
  5. Truncation flag set if anything dropped
```

_As of October 2026 the agent tools call `ChunkerService.buildContext()` with an unlimited budget; tool output is bounded by `max_results` (≤ 20 stories) and the 30-comment cap instead. The per-provider budgets above are not applied in code._

### 6.3 Comment Fetching Strategy

**Changed in v1.1: Hard cap reduced from 50 to 30.**

Each Firebase comment is an individual HTTP call. Fetching strategy:

```
1. Fetch parent story -> get kids[] (top-level comment IDs)
2. Sort kids by position (first = highest on page = most visible)
3. Fetch top 15 top-level comments (in parallel)
4. Fetch up to 3 replies for each of them, all parents in parallel (depth 1)
5. Fetch up to 3 replies for each depth-1 reply, all parents in parallel (depth 2)
6. Total cap: 30 comments regardless of tree shape (depth-first order, then truncated)
7. Skip deleted/dead comments (don't count toward cap)
```

Each depth level is one round of parallel requests, so a tree costs one round-trip per level rather than one per comment (ADR-009).

**HTTP calls:** up to 15 top-level + their replies + 1 parent; only the first 30 comments are returned
**Latency:** about three sequential rounds of parallel requests (one per depth level)
**Best-case (cached):** < 100ms

---

## 7. API Specification

### 7.1 POST `/api/rag/query`

Standard request-response. Blocks until the agent completes all steps. Responses are cached for 10 minutes per query string and mode.

**Request:**

```typescript
{
  query: string;              // Required. Natural language question. Max 500 chars.
  maxSteps?: number;          // Optional. 1-7. Default: 7. (Legacy agent only.)
  provider?: string;          // Optional. Override LLM provider for this query.
  useMultiAgent?: boolean;    // Optional. Default: false. true runs the pipeline.
}
```

**Response:**

```typescript
{
  answer: string;             // The synthesized answer
  steps: AgentStep[];         // Full reasoning chain
  sources: AgentSource[];     // Deduplicated story sources
  meta: {
    provider: string;         // Which LLM was used
    totalInputTokens: number;
    totalOutputTokens: number;
    durationMs: number;
    cached: boolean;          // True when a streaming request replays a recent answer
  }
}
```

Every source carries `postedDate` (YYYY-MM-DD, from the HN API) when known.

**Error Responses:**

| Status | Condition                                                          |
| ------ | ------------------------------------------------------------------ |
| 400    | Empty or missing `query`, or `query` over 500 chars                |
| 429    | Rate limit exceeded (60 req/min, global)                           |
| 500    | Agent execution failure (LLM error, API timeout, rejected API key) |

### 7.2 GET `/api/rag/stream`

Server-Sent Events endpoint. Streams reasoning steps in real time.

**Query Parameters:**

```
?query=...&provider=mistral&useMultiAgent=true&followUpOf=<queryId>
```

| Parameter       | Description                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `query`         | Required. Max 500 chars.                                                                                 |
| `provider`      | Optional. `mistral` (default), `openrouter`, or `claude`. Applied to every pipeline stage.               |
| `useMultiAgent` | `true` runs the pipeline (the frontend always sends it); anything else runs the legacy agent.            |
| `followUpOf`    | Optional, pipeline only. `queryId` of an earlier answer whose evidence to reuse (kept 30 min; see 3.10). |

**Event Types:**

| Event         | Payload                                                  | When                                                     |
| ------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `init`        | `{ queryId }`                                            | First event; use the ID to fetch the result or follow up |
| `pipeline`    | `PipelineEvent` (`stage`, `status`, `detail`, `elapsed`) | Pipeline stage transitions                               |
| `thought`     | `AgentStep`                                              | Agent is reasoning                                       |
| `action`      | `AgentStep` (with tool call)                             | Agent is calling a tool                                  |
| `observation` | `AgentStep` (with result)                                | Tool returned data                                       |
| `token`       | `{ content }`                                            | Live answer draft: an append-only markdown delta         |
| `answer`      | `{ answer, sources, trust, meta }`                       | Final answer ready (replaces the draft)                  |
| `error`       | `{ message }`                                            | Something broke (a rejected key names the env var)       |
| `ping`        | empty                                                    | Heartbeat every 10 s                                     |

An identical question already running is attached to rather than re-run; one completed in the last 15 minutes is replayed at once with `meta.cached: true`.

**Related: `GET /api/rag/query/:id/result`** returns the stored `QueryResult` for a `queryId`: 200 when complete or failed, 202 (same shape) while still running, 404 once expired. The frontend uses it to recover after a backgrounded tab.

### 7.3 POST `/api/tts/narrate`

**New in v1.2.** Converts an agent answer into podcast-style audio using Mistral Voxtral TTS.

**Request:**

```typescript
{
  text: string;               // Required. The agent's answer text. Max 10,000 chars.
  rewrite?: boolean;          // Optional. Default: true. Rewrite to podcast script first.
  voiceId?: string;           // Optional. Override signature voice. Voxtral preset slug
                              // (e.g. "en_paul_neutral") or custom voice UUID.
                              // Must match /^[A-Za-z0-9_-]{1,64}$/.
}
```

**Response:** A complete MP3 file (`Content-Type: audio/mpeg`), not a chunked stream. The backend buffers the full Voxtral output before responding so the response works behind reverse proxies that mishandle chunked audio. Playback starts once the file has downloaded.

**Headers:**

```
Content-Type: audio/mpeg
Content-Length: <bytes>         // Size of the complete MP3
X-TTS-Characters: 1042          // Characters sent to Voxtral (for cost tracking)
```

**Error Responses:**

| Status | Condition                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| 400    | Empty or missing `text`, `text` over 10,000 chars, or malformed `voiceId`                                  |
| 429    | Rate limit exceeded (60 req/min)                                                                           |
| 502    | Voxtral/Mistral upstream error (`TtsUpstreamError`); message includes Mistral's reason, e.g. unknown voice |
| 500    | Any other failure                                                                                          |

**Podcast Rewrite Flow:**

When `rewrite: true` (default), the text is first sent through a lightweight single-turn LLM call (`TtsService.rewriteForSpeech()`, via `LlmService`) that reformats it for spoken delivery. The system prompt lives in `apps/api/src/tts/prompts/narrator.prompt.ts` (`NARRATOR_SYSTEM_PROMPT`). In summary:

- **Voice:** calm, editorial, slightly opinionated, "like a tech-savvy NPR host"; conversational but efficient.
- **Structure:** a 1-2 sentence opening hook, a 3-6 sentence body with attributions and transitions, then a punchy closing line followed by a variant of "VoxPopuli, signing off."
- **Fidelity rules:** no invented claims, statistics or opinions; preserve every attribution; convert markdown citations such as `[Story 12345]` into spoken references.
- **Length:** output is capped at 2,500 characters (`MAX_NARRATION_CHARS`) before it is sent to Voxtral.

### 7.4 GET `/api/health`

Health check endpoint. Returns provider status and cache stats.

```typescript
{
  status: 'ok';
  uptime: number; // seconds
  cacheStats: {
    hits: number;
    misses: number;
    keys: number;
  }
  memoryMB: number; // heap used
}
```

This check makes no LLM call, so it is safe for load balancers and platform health checks.

### 7.5 GET `/api/health/llm`

**New in v3.3.** For operators: makes a tiny real call (5-token cap, 15 s timeout) to the active LLM provider, so a missing or rejected API key shows up here instead of as failed user queries. The result is cached for 60 seconds so the endpoint cannot be used to run up provider costs. It is opt-in and not meant as the platform health check.

```typescript
{
  provider: string;
  ok: boolean;
  latencyMs: number;
  error?: 'auth' | 'unavailable';  // auth = the provider rejected the API key
  detail?: string;                 // first line of the provider error, max 200 chars
}
```

Returns 200 when `ok` is true, 503 otherwise.

---

## 8. Agent Tool Specifications

The agent has access to three tools. The LLM decides which to call and in what order.

### 8.1 `search_hn`

| Parameter     | Type                      | Required | Description                |
| ------------- | ------------------------- | -------- | -------------------------- |
| `query`       | string                    | Yes      | Search keywords            |
| `sort_by`     | `"relevance"` \| `"date"` | No       | Default: relevance         |
| `min_points`  | number                    | No       | Filter low-quality stories |
| `max_results` | number                    | No       | 1-20, default 10           |

**Behavior:** Calls HN Algolia `/search` or `/search_by_date`. Results pass through CacheService (TTL: 15 min), then are chunked and token-counted before returning to the agent. Each hit's metadata (including its posted date) is recorded in the per-request source registry. If `min_points` leaves fewer than 3 hits, the search is retried once without it and the output starts with a note saying so.

### 8.2 `get_story`

| Parameter  | Type   | Required | Description |
| ---------- | ------ | -------- | ----------- |
| `story_id` | number | Yes      | HN item ID  |

**Behavior:** Calls HN Firebase `/item/{id}.json`. Cached for 1 hour. Returns title, author, points, comment count, URL, text and posted date, and records the story in the source registry.

### 8.3 `get_comments`

| Parameter   | Type   | Required | Description     |
| ----------- | ------ | -------- | --------------- |
| `story_id`  | number | Yes      | Parent story ID |
| `max_depth` | number | No       | 1-5, default 3  |

**Behavior:** Fetches the comment tree via Firebase one depth level at a time, all parents in parallel (fetching stops at 3 levels even if `max_depth` is higher). Individual items cached for 30 min. Strips HTML, assigns depth levels, **caps at 30 comments**. Output lines are tagged `[Story <id>]`, which the research timeline uses to count comments per story.

---

## 9. Tool Use Protocol (via LangChain)

**This section documents the tool calling architecture. Updated in v2.0 to reflect LangChain.js integration.**

### 9.1 How Tool Calling Works

LangChain handles all provider-specific tool protocol differences internally. We define tools once using LangChain's `tool()` helper with Zod schemas, and LangChain translates them to the correct format per provider:

```typescript
import { tool } from 'langchain';
import { z } from 'zod';

const searchHnTool = tool(
  async (input) => {
    // Calls HnService.search(), records sources, chunks results, returns string
  },
  {
    name: 'search_hn',
    description: 'Search Hacker News stories via Algolia...',
    schema: z.object({
      query: z.string().describe('Search keywords'),
      sort_by: z.enum(['relevance', 'date']).optional(),
      min_points: z.coerce.number().optional(),
      max_results: z.coerce.number().min(1).max(20).optional(),
    }),
  },
);
```

### 9.2 What LangChain Handles Per Provider

| Provider       | Tool Format (handled by LangChain)        | Our Code                                                 |
| -------------- | ----------------------------------------- | -------------------------------------------------------- |
| **Claude**     | `tool_use` / `tool_result` content blocks | Just provide `ChatAnthropic` instance                    |
| **Mistral**    | OpenAI-compatible `tool` role messages    | Just provide `ChatMistralAI` instance                    |
| **OpenRouter** | OpenAI-compatible `tool` role messages    | Just provide `ChatOpenAI` instance (OpenRouter base URL) |

LangChain's `createAgent` (v1.2+) manages the ReAct loop internally, including:

- Parsing tool calls from model responses
- Executing tools and formatting results
- Building native tool_result messages per provider
- Managing the conversation history with tool results

### 9.3 Why This Matters

Using native protocols (via LangChain) gives the model clear separation between its own reasoning and external data. This produces:

- More accurate tool selection on steps 2+
- Fewer hallucinated tool arguments
- Better synthesis when multiple tool results are in context

### 9.4 What We Still Own

LangChain handles the protocol plumbing, but we control:

- **Tool implementations** (callbacks that call HnService + ChunkerService)
- **Token budgeting** (ChunkerService fits content into provider-specific budgets)
- **Caching** (CacheService wraps all external API calls)
- **Step streaming** (we intercept agent callbacks to emit SSE events)
- **Safety constraints** (legacy agent: max 7 steps, 180s timeout, 5 concurrent runs; pipeline Retriever: 8 ReAct iterations, 768 output tokens per turn)

Source: [LangChain.js Tool Calling](https://js.langchain.com/docs/how_to/tool_calling/), [LangChain.js Agents](https://js.langchain.com/docs/how_to/agent_executor/)

### 9.5 Pipeline Configuration (v3.0)

The multi-agent pipeline is configured via `PipelineConfig` (a Zod schema, `PipelineConfigSchema`, in `libs/shared-types/src/lib/pipeline.types.ts`):

```typescript
interface PipelineConfig {
  useMultiAgent: boolean; // Schema default: false. The frontend always sends true.
  providerMap: {
    // Each stage falls back to the global LLM_PROVIDER when unset
    retriever?: string;
    synthesizer?: string;
    writer?: string;
  };
  tokenBudgets: {
    retriever: number; // default 2000
    synthesizer: number; // default 1500
    synthesizerInput: number; // default 4000
    writer: number; // default 1000
  };
  timeout: number; // default 30000 ms
}
```

**Default configuration:** All three agents use the globally selected provider (`LLM_PROVIDER`, default: `mistral`).

_`tokenBudgets` and `timeout` are defined with defaults but not enforced by the pipeline (October 2026). Output size is bounded per call site instead (e.g. the Retriever's 768-token ReAct cap)._

Per-stage provider splitting (e.g., OpenRouter for retrieval, Claude for synthesis) is possible via `providerMap` in code but deferred as default until eval data justifies it.

**Environment switch:** `PIPELINE_MERGED_WRITER=true` replaces the Synthesizer with a no-LLM stand-in and has the Writer analyze the evidence directly (default `false`; see 3.3 and ADR-010).

**SSE event protocol:**

| Event      | Payload Fields                         | When                              |
| ---------- | -------------------------------------- | --------------------------------- |
| `pipeline` | `stage`, `status`, `detail`, `elapsed` | Each stage transition             |
| `token`    | `content`                              | Live answer draft from the Writer |

Stage values: `retriever` | `synthesizer` | `writer`
Status values: `started` | `progress` | `done` | `error`

---

## 10. Project Structure

```
voxpopuli/
+-- apps/
|   +-- api/                              # NestJS backend
|   |   +-- src/
|   |       +-- agent/
|   |       |   +-- agent.module.ts
|   |       |   +-- agent.service.ts        # Legacy ReAct loop (fallback)
|   |       |   +-- orchestrator.service.ts # LangGraph pipeline coordination
|   |       |   +-- pipeline-graph.ts       # LangGraph StateGraph definition + retry wrappers
|   |       |   +-- nodes/
|   |       |   |   +-- retriever.node.ts   # ReAct search + compaction
|   |       |   |   +-- compaction-parse.ts # Lenient parsing of compacted themes
|   |       |   |   +-- synthesizer.node.ts # Single-pass analysis, evidence floor, merged stand-in
|   |       |   |   +-- writer.node.ts      # Single-pass prose composition
|   |       |   |   +-- writer-draft.ts     # Live draft rendering + streaming deltas
|   |       |   +-- tools.ts                # Tool definitions + source registry
|   |       |   +-- trust.ts                # Trust metadata
|   |       |   +-- system-prompt.ts        # Legacy agent instructions
|   |       |   +-- prompts/
|   |       |       +-- retriever.prompt.ts
|   |       |       +-- compactor.prompt.ts
|   |       |       +-- synthesizer.prompt.ts
|   |       |       +-- writer.prompt.ts
|   |       |       +-- merged-writer.prompt.ts # Opt-in merged Synthesizer+Writer
|   |       +-- cache/
|   |       |   +-- cache.module.ts
|   |       |   +-- cache.service.ts      # lru-cache wrapper
|   |       |   +-- query-store.ts        # Query results, replay/dedup, follow-up evidence
|   |       +-- health/
|   |       |   +-- health.controller.ts  # GET /api/health, GET /api/health/llm
|   |       +-- chunker/
|   |       |   +-- chunker.module.ts
|   |       |   +-- chunker.service.ts    # HTML cleanup, token budgeting
|   |       +-- hn/
|   |       |   +-- hn.module.ts
|   |       |   +-- hn.service.ts         # Algolia + Firebase + caching
|   |       +-- llm/
|   |       |   +-- llm.module.ts
|   |       |   +-- llm.service.ts        # Facade (delegates to provider)
|   |       |   +-- llm-provider.interface.ts
|   |       |   +-- llm-errors.ts         # Auth-error detection, LlmAuthError, fail-fast retry policy
|   |       |   +-- model-ids.ts          # All model identifiers
|   |       |   +-- invoke-with-retry.ts  # Shared retry utility (exponential backoff, TPM detection)
|   |       |   +-- providers/
|   |       |       +-- claude.provider.ts
|   |       |       +-- mistral.provider.ts
|   |       |       +-- openrouter.provider.ts
|   |       +-- rag/
|   |       |   +-- rag.module.ts
|   |       |   +-- rag.controller.ts     # POST + SSE endpoints
|   |       +-- tts/
|   |       |   +-- tts.module.ts
|   |       |   +-- tts.controller.ts     # Narrate + voices endpoints
|   |       |   +-- tts.service.ts        # Mistral Voxtral TTS + podcast rewrite
|   |       |   +-- mp3-xing.ts           # Adds a Xing header so browsers get the right duration
|   |       |   +-- prompts/
|   |       |       +-- narrator.prompt.ts # Podcast rewrite prompt, 2500-char cap
|   |       +-- app/
|   |       |   +-- app.module.ts         # Root module
|   |       +-- main.ts
|   |
|   +-- web/                              # Angular frontend
|       +-- src/
|           +-- app/
|               +-- components/
|               |   +-- chat/
|               |   +-- agent-steps/
|               |   +-- source-card/       # Includes the posted date
|               |   +-- meta-bar/          # Provider, tokens, time, "cached" badge
|               |   +-- trust-bar/
|               |   +-- audio-player/      # Listen button + playback controls
|               |   +-- provider-selector/ # Switch providers in UI
|               +-- services/
|               |   +-- rag.service.ts
|               |   +-- tts.service.ts     # POST to /api/tts/narrate, play audio
|               +-- app.component.ts
|
+-- libs/
|   +-- shared-types/                     # Shared TypeScript interfaces
|       +-- src/
|           +-- index.ts
|           +-- lib/
|               +-- shared-types.ts       # AgentResponse, AgentSource, health and query-result types
|               +-- evidence.types.ts     # EvidenceBundle, ThemeGroup, EvidenceItem, SourceMetadata
|               +-- analysis.types.ts     # AnalysisResult, Insight, Contradiction
|               +-- response-v2.types.ts  # AgentResponseV2, ResponseSection
|               +-- pipeline.types.ts     # PipelineConfig, PipelineEvent, PipelineResult, PriorEvidence
|
+-- evals/                                # Evaluation harness
|   +-- queries.json                      # Test queries + expected qualities
|   +-- run-eval.ts                       # Runner script (pipeline over SSE by default)
|   +-- stream-client.ts                  # SSE client with per-stage timings
|   +-- score.ts                          # Scoring logic
|   +-- latency-stats.ts                  # Mean/p50/p95 latency summary
|   +-- evaluators/                       # Source accuracy, quality judge, efficiency, latency, cost
|   +-- results/                          # Timestamped eval results
|
+-- nx.json
+-- tsconfig.base.json
+-- package.json
+-- .env
+-- .env.example
```

---

## 11. Key Design Decisions

### 11.1 Why ReAct over simple RAG?

Simple RAG: search once, stuff context, generate answer.
ReAct agent: search, evaluate, search again, dive into comments, THEN answer.

The agent produces dramatically better answers because it can:

- Reformulate queries based on initial results.
- Decide whether comments are worth fetching for a given story.
- Cross-reference multiple threads.
- Stop early when it has enough.

**Tradeoff:** More LLM calls (cost + latency). Mitigated by capping steps at 7 and streaming results.

### 11.2 Why SSE over WebSockets?

- SSE is simpler. Unidirectional (server to client) is all we need for streaming agent steps.
- Native browser support via `EventSource`. No library needed.
- NestJS has first-class `@Sse()` decorator support.
- Automatic reconnection built into the protocol.

WebSockets needed only if we add bidirectional follow-ups. That's a v2 feature.

_Follow-up questions shipped in v3.3 without WebSockets: each follow-up is a new SSE request that names the earlier answer with `followUpOf` (see 3.10)._

Source: [MDN > EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource), [NestJS > SSE](https://docs.nestjs.com/techniques/server-sent-events)

### 11.3 Why Nx monorepo?

- **Shared types.** `@voxpopuli/shared-types` is the single source of truth. Change once, type-checked everywhere.
- **Unified tooling.** One `nx serve` per app. One `nx test`. One CI pipeline.
- **Dependency graph.** Nx rebuilds/retests only what's affected.

Source: [Nx docs > Why Nx](https://nx.dev/getting-started/why-nx)

### 11.4 Why triple-stack LLM instead of one?

See Section 5.1. Summary: Claude for quality, Mistral for cost, OpenRouter (Qwen3) for speed/dev. The provider interface adds ~200 lines of code. The savings justify it on day one.

### 11.5 Why not vector embeddings?

v1 uses Algolia keyword search. The agent compensates for keyword limitations by running multiple searches with different phrasings. Vector search adds infrastructure not justified until the agent loop is proven. v2 adds embeddings.

### 11.6 Why cache in v1?

Without caching, development burns through rate limits in an afternoon. Caching is infrastructure, not polish.

### 11.7 Why Multi-Agent Pipeline over Single ReAct?

The single ReAct agent handles retrieval, analysis, and composition in one loop. This creates three problems:

1. **Context exhaustion.** The agent retrieves 30+ comments (~6,000 tokens of raw signal mixed with noise) then has to write the final answer with whatever reasoning budget is left.
2. **No explicit synthesis.** The agent jumps from "here's what I found" to "here's my answer" with no structured analysis in between.
3. **Single system prompt.** One instruction set handles search strategy, evidence evaluation, AND prose composition -- three distinct cognitive tasks.

The pipeline solves this by giving each agent exactly one job, one system prompt, and one output format. The Retriever compacts raw data, so the Synthesizer never sees noise. The Synthesizer structures analysis, so the Writer never has to reason about evidence strength.

**Cost impact:** Three LLM calls instead of one, but each call is smaller and more focused. With OpenRouter (Qwen3, ~$0.087/$0.35 per M tokens) handling the Retriever and Mistral handling the Writer, only the Synthesizer uses the expensive Claude tier. Net cost is comparable to a single Claude ReAct run.

### 11.8 Why Compaction as a Separate Step?

The Retriever's ReAct loop collects raw HN data. A separate "compaction" LLM call after the loop converts 30+ raw comments into 3-6 themed evidence groups at ~600 tokens total. This is a separate call (not part of the ReAct loop) because:

- Collection and compaction are different cognitive tasks. Mixing them degrades both.
- Compaction has a fixed output shape (`EvidenceBundle`), making it reliable to parse.
- The compacted bundle is the **only** thing that crosses the Retriever boundary. No raw HN data reaches the Synthesizer.

---

## 12. Evaluation Harness

**New in v1.1. Build this before the frontend.**

### 12.1 Why?

Success metrics (Section 15) are aspirational without tooling to measure them. The eval harness catches regressions when you change the system prompt, swap providers, or modify chunking.

**LangSmith integration:** Since VoxPopuli uses LangChain.js for the agent, LangSmith provides automatic tracing (every agent step, tool call, token count) and an `evaluate()` function that handles the run loop, concurrency, and result storage. The eval harness uses a hybrid approach: queries are version-controlled locally in `queries.json`, synced to a LangSmith dataset on each run, with results saved both to LangSmith (dashboard) and locally (JSON). LangSmith's free tier (5k traces/month) is sufficient.

### 12.2 Test Query Format

**File:** `evals/queries.json`

```json
[
  {
    "id": "q01",
    "query": "What does HN think about Rust vs Go for backend services?",
    "expectedQualities": [
      "mentions_both_languages",
      "cites_specific_stories",
      "includes_community_opinions",
      "presents_multiple_viewpoints"
    ],
    "expectedMinSources": 2,
    "maxAcceptableSteps": 5
  },
  {
    "id": "q02",
    "query": "Has anyone built a successful SaaS with just SQLite?",
    "expectedQualities": [
      "mentions_specific_projects",
      "discusses_limitations",
      "cites_specific_stories"
    ],
    "expectedMinSources": 1,
    "maxAcceptableSteps": 4
  }
]
```

### 12.3 Scoring

| Metric                | How                                                                                                       | Weight |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| **Source accuracy**   | Every source's story ID resolves via the HN Firebase API                                                  | 30%    |
| **Quality checklist** | LLM-as-judge checks each `expectedQuality`                                                                | 30%    |
| **Efficiency**        | Tool calls (`action` steps) vs `maxAcceptableSteps`; 0 at 2x                                              | 15%    |
| **Latency**           | Total duration vs provider-specific bands (Mistral/Claude: full marks up to 30 s; OpenRouter: up to 15 s) | 15%    |
| **Cost**              | Estimated cost vs $0.05 ceiling, at per-provider rates                                                    | 10%    |

**Cost rates (per million input/output tokens):** Mistral Small 4 $0.15 / $0.60, Claude Haiku 4.5 $1 / $5, OpenRouter Qwen3 235B $0.087 / $0.35.

A run that fell back to the legacy agent scores 0 on cost and efficiency, because only the fallback's tokens and steps are reported and the failed pipeline run would otherwise look cheap.

**LLM-as-judge:** A direct Mistral API call evaluates the answer against expected qualities. Configurable via `EVAL_JUDGE_PROVIDER` env var. The judge strips markdown fences from LLM responses and is fully decoupled from the NestJS app -- it makes its own HTTP call to the provider's OpenAI-compatible endpoint. When LangSmith is enabled, individual evaluator scores are posted as feedback to each trace.

### 12.4 Running Evals

**Prerequisites:** Running VoxPopuli API (`pnpm exec nx serve api`), at least one LLM provider key configured. Optionally, `LANGSMITH_API_KEY` for dashboard integration.

By default the harness runs what users run: the pipeline over SSE. `--legacy` evaluates the single-agent path instead, and `--no-stream` uses `POST /api/rag/query` (cached 10 minutes, no per-stage timings).

**CLI** (commander-based):

```bash
pnpm exec tsx evals/run-eval.ts --help              # Show all options
pnpm exec tsx evals/run-eval.ts --list              # Browse queries by category
pnpm exec tsx evals/run-eval.ts -p mistral          # Single provider
pnpm exec tsx evals/run-eval.ts -p mistral -n 5     # Max parallelism
pnpm exec tsx evals/run-eval.ts --no-judge -n 5     # Fast mode (skip LLM-as-judge)
pnpm exec tsx evals/run-eval.ts -C trust            # Trust queries only
pnpm exec tsx evals/run-eval.ts -q q01              # Single query debug
pnpm exec tsx evals/run-eval.ts --dry-run           # Preview without running
pnpm exec tsx evals/run-eval.ts -c openrouter,mistral # Compare providers
pnpm exec tsx evals/run-eval.ts -n 1 --baseline evals/results/<old>.json # Latency A/B
```

| Flag                | Default            | Description                               |
| ------------------- | ------------------ | ----------------------------------------- |
| `-p, --provider`    | `LLM_PROVIDER` env | Provider to evaluate                      |
| `-c, --compare`     | —                  | Comma-separated providers to compare      |
| `-q, --query`       | —                  | Run a single query by ID                  |
| `-C, --category`    | —                  | Filter queries by category                |
| `--list`            | —                  | List all queries grouped by category      |
| `--dry-run`         | —                  | Preview matched queries without executing |
| `-n, --concurrency` | 3                  | Parallel query execution (max 5)          |
| `-t, --timeout`     | 300s               | Per-query timeout                         |
| `--no-judge`        | —                  | Skip LLM-as-judge quality evaluator       |
| `--no-langsmith`    | —                  | Disable LangSmith integration             |
| `--legacy`          | —                  | Evaluate the legacy single-agent path     |
| `--no-stream`       | —                  | Use `POST /api/rag/query` instead of SSE  |
| `--baseline`        | —                  | Print latency change vs an earlier report |

`--multi-agent` and `--stream` are still accepted but do nothing (both are now the default).

**Pass threshold:** 0.6 weighted score. Results saved to `evals/results/` with timestamps; each report includes `summary.latency` (mean, p50, p95, per-stage means and the fallback count). If `LANGSMITH_API_KEY` is set, results also appear in the LangSmith dashboard with full agent traces and per-evaluator feedback scores. Run after every agent-related change.

**Token tracking:** The agent reports real token counts from LangChain `usage_metadata`, enabling accurate cost scoring.

### 12.5 Test Suite (27 queries: 20 general + 7 trust)

| Category           | Count | Examples                                                                                              |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------- |
| Tool comparisons   | 5     | "Rust vs Go", "React vs Svelte"                                                                       |
| Opinion/sentiment  | 4     | "What does HN think about remote work?"                                                               |
| Specific projects  | 3     | "Has anyone used Turso in production?"                                                                |
| Recent events      | 3     | "Latest AI agent frameworks"                                                                          |
| Deep-dive requests | 3     | "Best arguments against microservices"                                                                |
| Edge cases         | 2     | Gibberish input, non-HN questions                                                                     |
| Trust (M5)         | 7     | Source verification, consensus honesty, recency awareness (t06/t07 skipped pending M5 implementation) |

**First real run (Mistral):** 52% pass rate (13/25 passed). Baseline for regression tracking.

_Later runs: after the latency work (ADR-009) the pipeline passed 92% of the suite, and the merged writer run passed 100% (ADR-010). See those ADRs for the reports._

---

## 13. Trustworthiness Framework

VoxPopuli has three trust layers. Each can fail independently. Each needs its own checks.

### 13.1 Layer 1: Agent Trustworthiness

The agent can hallucinate sources, fabricate consensus, cherry-pick stories, present outdated info as current, or generate confident nonsense when it found nothing.

**Automated checks (run in eval harness):**

| Check                | How                                                                | Target |
| -------------------- | ------------------------------------------------------------------ | ------ |
| Source existence     | Every `AgentSource.id` resolves via Firebase API (HTTP 200)        | 100%   |
| Attribution accuracy | Named usernames in answer appear in fetched comments (fuzzy match) | 95%+   |
| Consensus honesty    | LLM-as-judge: does answer present both sides on split topics?      | 80%+   |
| Source coverage      | `cited_sources / fetched_sources` ratio                            | > 20%  |
| Recency awareness    | Stories older than 2 years flagged in answer                       | 100%   |
| Honest "no results"  | Gibberish queries produce explicit "nothing found" disclaimer      | 100%   |

**Agent prompt rules that enforce trust:**

- "If all searches returned 0 relevant hits, say so. Do not fabricate an answer."
- "If the most relevant story is older than 2 years, explicitly note this."
- "High upvotes indicate popularity, not necessarily correctness. Note whether commenters provide evidence or just opinion."
- "If all top comments agree, search for a contrarian thread using terms like 'defense of X' or 'why X is actually good.'"

**Enforced in code, not just the prompt (v3.3):** the pipeline caps confidence when fewer than 3 sources were found and adds a gap note saying how thin the evidence is (see 3.11). Every source's posted date now comes from the HN API, and source cards show it. (The trust bar's recency metrics are still computed from `get_story` output in the steps.)

### 13.2 Layer 2: HN Crowd Trustworthiness

The crowd can be wrong. HN has known biases: Bay Area/startup culture, early adopter preferences, contrarian tendencies, language biases (Rust love, Java skepticism), and groupthink on certain topics.

**Mitigations built into the system:**

| Bias                                                       | Mitigation                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Survivorship bias** (confident prose > correct answers)  | Agent notes whether commenters provide evidence (benchmarks, links, experience) or just opinion                                          |
| **Demographic bias** (not representative of all engineers) | Standing disclaimer in UI: "VoxPopuli reflects HN community opinions, which skew toward startup culture and early adopter perspectives." |
| **Astroturfing / self-promotion**                          | Agent flags Show HN posts (author has vested interest). Source cards show `[Show HN]` tag.                                               |
| **Temporal decay**                                         | Agent prefers stories from last 12 months for current-state queries. Source cards show dates prominently.                                |
| **Groupthink**                                             | Agent prompt: actively search for contrarian threads on one-sided topics. Eval tests include known groupthink topics.                    |

**Automated checks:**

| Check                             | How                                                                                | Target               |
| --------------------------------- | ---------------------------------------------------------------------------------- | -------------------- |
| Recency of sources                | % of cited sources from last 12 months (for current-state queries)                 | > 60%                |
| Viewpoint diversity               | LLM-as-judge: does answer include at least one dissenting view on opinion queries? | 80%+                 |
| Show HN bias noted                | Answer mentions author's vested interest when citing Show HN posts                 | 100% (tag detection) |
| Evidence vs opinion distinguished | LLM-as-judge: does answer differentiate between backed claims and pure opinion?    | 70%+                 |

### 13.3 Layer 3: Podcast Rewrite Trustworthiness

The rewrite step is a game of telephone. Every transformation can lose or distort meaning.

**Five failure modes and their checks:**

| Failure                                                     | Check                       | How                                                              | Target                 |
| ----------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------- | ---------------------- |
| **Fact injection** (rewrite adds info not in original)      | Fact preservation test      | LLM-as-judge: "Does rewrite contain claims not in the original?" | 100% (zero new claims) |
| **Softening/hardening** ("divided" becomes "agreed")        | Sentiment preservation test | LLM-as-judge: compare confidence levels in original vs rewrite   | 95%+                   |
| **Attribution loss** (drops usernames)                      | Attribution retention       | Count named sources in original vs rewrite                       | > 80% retained         |
| **Nuance flattening** (5 arguments become 2)                | Argument coverage           | Count distinct claims in original vs rewrite                     | > 70% retained         |
| **Tone mismatch** (measured original, enthusiastic rewrite) | Tone alignment              | LLM-as-judge: rate tone match on 1-5 scale                       | > 4.0 average          |

**Prompt rules that enforce trust:**

- "Do NOT add information that wasn't in the original answer."
- "Preserve the original answer's level of certainty."
- "Keep all username attributions. Convert to spoken form but do not drop them."
- "Match the original answer's tone."

### 13.4 Trust Pipeline (Runtime)

```
Query arrives
     |
     v
Agent Loop
     +-- Source existence check (every ID resolves)
     +-- Attribution cross-reference (quotes match tool results)
     +-- Consensus honesty check (split topics flagged)
     |
     v
Answer produced
     +-- Recency tags on all sources
     +-- Viewpoint diversity score
     +-- Show HN bias flag
     +-- Trust metadata attached to AgentResponse
     |
     v
User clicks Listen (optional)
     |
     v
Podcast Rewrite
     +-- Fact preservation check
     +-- Sentiment preservation check
     +-- Attribution retention check
     |
     v
Audio delivered with trust indicators in UI
```

### 13.5 Trust Indicators in the UI

Users should assess trust at a glance:

```
+----------------------------------------------------+
| Agent Answer                                        |
|                                                     |
| "HN is broadly positive on Tailwind v4..."          |
|                                                     |
| [Trust Bar]                                         |
| Sources: 4 verified  |  Recency: 3/4 from 2026     |
| Viewpoints: balanced |  Show HN: 1 (flagged)        |
|                                                     |
| Sources: [card] [card] [card] [card]                |
|                                                     |
| [> Listen]  [Trust details v]                       |
+----------------------------------------------------+
```

Expandable trust details show: which sources were verified, their dates, whether contrarian views were found, Show HN flags, and for narrated answers, "Narration verified: no new claims added."

### 13.6 Trust-Specific Eval Queries

Add to `evals/queries.json`:

| ID  | Query                                     | What It Tests                                              |
| --- | ----------------------------------------- | ---------------------------------------------------------- |
| t01 | "Is Rust better than Go?"                 | Must present both sides. Fails if one-sided.               |
| t02 | "What does HN think of xyzzy florbnog?"   | Must say "no relevant discussions found."                  |
| t03 | "Is crypto dead?"                         | Must find at least one contrarian view (known groupthink). |
| t04 | Query targeting a Show HN post            | Must flag author's vested interest.                        |
| t05 | Query about a 2019-era tool as if current | Must note the age of sources.                              |
| t06 | Podcast rewrite of a balanced answer      | Rewrite must preserve balance.                             |
| t07 | Podcast rewrite of a heavily-cited answer | Must retain 80%+ named attributions.                       |

### 13.7 New Shared Types

```typescript
// Add to libs/shared-types/src/index.ts

export interface TrustMetadata {
  sourcesVerified: number; // Count of source IDs that resolved
  sourcesTotal: number; // Total sources cited
  avgSourceAge: number; // Average age in days
  recentSourceRatio: number; // % from last 12 months
  viewpointDiversity: 'one-sided' | 'balanced' | 'contested';
  showHnCount: number; // Number of Show HN sources (bias flag)
  honestyFlags: string[]; // e.g., ["no_results_found", "old_sources_noted"]
}

export interface RewriteTrustMetadata {
  factPreservation: boolean; // No new claims added
  attributionsRetained: number; // % of named sources kept
  toneAlignment: number; // 1-5 scale
}

// Updated AgentResponse
export interface AgentResponse {
  answer: string;
  steps: AgentStep[];
  sources: AgentSource[];
  trust: TrustMetadata; // NEW
  meta: {
    /* existing fields */
  };
}
```

### 13.9 Pipeline Types (v3.0)

_This is the v3.0 design. The shipped Zod schemas in `libs/shared-types/src/lib/` differ in places (for example, `EvidenceItem` has `text`, `type` and `relevance`; `PipelineEvent` has `detail` and `elapsed`; `SourceMetadata` gained `postedDate`; `PriorEvidence` was added for follow-ups). The code is the source of truth._

```typescript
// Evidence types (Retriever output)
export interface EvidenceItem {
  sourceId: number;
  sourceType: 'story' | 'comment';
  content: string; // 1-3 sentences, NOT raw text
  classification: 'evidence' | 'anecdote' | 'opinion' | 'consensus';
  relevance: number; // 0.0 to 1.0
  timestamp: string;
  metadata: SourceMetadata;
}

export interface ThemeGroup {
  label: string; // "Performance concerns", "Migration stories"
  evidence: EvidenceItem[];
  sentiment: 'positive' | 'negative' | 'mixed' | 'neutral';
  rawSourceCount: number;
}

export interface EvidenceBundle {
  query: string;
  themes: ThemeGroup[];
  totalSourcesScanned: number;
  tokenCount: number;
  timeRange: { earliest: string; latest: string };
  allSources: SourceMetadata[];
}

// Analysis types (Synthesizer output)
export interface Insight {
  claim: string;
  supportingThemes: number[];
  strength: 'strong' | 'moderate' | 'weak';
  reasoning: string;
}

export interface Contradiction {
  positionA: string;
  positionB: string;
  relevantThemes: number[];
  assessment: string;
}

export interface AnalysisResult {
  insights: Insight[]; // 3-5, strongest first. NEVER more than 5.
  contradictions: Contradiction[];
  confidence: 'high' | 'medium' | 'low';
  gaps: string[];
  summary: string;
}

// Response types (Writer output)
export interface ResponseSection {
  heading: string;
  body: string;
  citedSources: number[];
}

export interface AgentResponse {
  headline: string;
  context: string;
  sections: ResponseSection[];
  bottomLine: string;
  confidence: 'high' | 'medium' | 'low';
  gaps: string[];
  sources: SourceMetadata[];
}

// Pipeline types (Orchestrator)
export interface PipelineConfig {
  /** Optional — when omitted, all stages use the global LLM_PROVIDER. */
  providerMap?: { retriever: LlmProvider; synthesizer: LlmProvider; writer: LlmProvider };
  tokenBudgets: { retriever: number; synthesizer: number; writer: number };
  timeoutMs: number;
  useMultiAgent: boolean;
}

// Default config: all stages use global LLM_PROVIDER (default: mistral).
// Pipeline is the default mode — frontend always passes useMultiAgent: true.
// Additional presets (optimized, speed, cost) deferred until eval data justifies per-stage splitting.

export type PipelineStage = 'retriever' | 'synthesizer' | 'writer';
export type StageStatus = 'started' | 'progress' | 'done' | 'error';

export interface PipelineEvent {
  stage: PipelineStage;
  status: StageStatus;
  detail?: string;
  elapsedMs?: number;
  summary?: string;
}

export interface PipelineResult {
  response: AgentResponse;
  intermediates: { evidenceBundle: EvidenceBundle; analysisResult: AnalysisResult };
  timing: Record<PipelineStage, number>;
  tokenUsage: Record<PipelineStage, { input: number; output: number }>;
  providersUsed: Record<PipelineStage, LlmProvider>;
}
```

### 13.8 Fact vs Opinion Distinction

HN comments mix testable claims, personal experience, and subjective takes in the same sentence. VoxPopuli must surface this distinction at every layer.

**Claim taxonomy:**

| Type          | Definition                                      | Agent Phrasing                              | UI Badge    | Podcast Cue                                    |
| ------------- | ----------------------------------------------- | ------------------------------------------- | ----------- | ---------------------------------------------- |
| **Evidence**  | Backed by data, benchmarks, links               | "User X reported [specific detail]..."      | Blue badge  | "And there's data to back this up..."          |
| **Consensus** | Multiple commenters independently agree         | "Several commenters independently noted..." | Green badge | "This is where the thread converged..."        |
| **Anecdote**  | Personal experience, not independently testable | "In their experience..."                    | Amber badge | "Now, this is one person's experience, but..." |
| **Opinion**   | Subjective preference or prediction             | "Some commenters argued..."                 | Gray badge  | "Not everyone agrees..."                       |

**Credibility signals the agent should weight:**

| Signal                                     | Detection              | Effect                           |
| ------------------------------------------ | ---------------------- | -------------------------------- |
| Specific data (numbers, benchmarks)        | Text analysis          | Elevates to evidence             |
| Self-identified expertise ("I maintain X") | Text pattern           | Notes credentials in attribution |
| High upvotes (50+)                         | Comment metadata       | Community-validated              |
| Links to external sources                  | URL detection          | External evidence                |
| Contradicted by upvoted replies            | Child comment analysis | Weakens parent claim             |

**Implementation:**

- **v1.0 (free, prompt-only):** Agent system prompt classifies claims using the phrasing above. Podcast rewrite prompt uses verbal cues. Zero extra cost.
- **v1.1 (structured):** Second LLM pass extracts `Claim[]` metadata from the answer. UI renders color-coded badges. ~$0.002/query on Groq.

**New type:**

```typescript
export interface Claim {
  text: string;
  type: 'evidence' | 'anecdote' | 'opinion' | 'consensus';
  attribution: string;
  confidence: number; // 0-1
  supportingData?: string; // benchmark, link, or specific detail
}
```

---

## 14. Non-Functional Requirements

### 14.1 Performance

**Revised in v1.1: Honest latency targets.**

_Measured with Groq before the switch to OpenRouter (2026-09)._

| Metric                  | Groq    | Mistral | Claude  |
| ----------------------- | ------- | ------- | ------- |
| Time to first SSE event | < 1s    | < 1.5s  | < 2s    |
| 3-step query            | < 8s    | < 12s   | < 15s   |
| 5-step query            | < 15s   | < 20s   | < 30s   |
| Cached query            | < 100ms | < 100ms | < 100ms |

**P50/P95 estimates (realistic):**

| Metric | Groq | Mistral | Claude |
| ------ | ---- | ------- | ------ |
| P50    | ~6s  | ~10s    | ~13s   |
| P95    | ~12s | ~20s    | ~28s   |

**Measured: multi-agent pipeline on Mistral (full eval suite, sequential, 2026-09/10):**

| Mode                                     | Mean   | P50    | P95    | Source  |
| ---------------------------------------- | ------ | ------ | ------ | ------- |
| Three-stage pipeline (after ADR-009)     | 23.9 s | 23.6 s | 30.4 s | ADR-009 |
| Merged writer (`PIPELINE_MERGED_WRITER`) | 18.8 s | 18.2 s | 30.6 s | ADR-010 |

A repeated question within 15 minutes is replayed immediately, and the live draft (3.9) shows the answer forming while the Writer runs.

### 14.2 Reliability

| Concern             | Mitigation                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| HN API downtime     | Retry with exponential backoff (3 attempts)                                                                      |
| LLM API errors      | Return partial results with error flag; pipeline falls back to the legacy agent on the same provider             |
| Rejected API key    | Fail fast with a message naming the env var; no fallback run; `GET /api/health/llm` for operators                |
| LLM provider outage | Optional auto-fallback to next provider (not implemented)                                                        |
| Runaway agent loop  | Hard cap at 7 steps + 180s global timeout (legacy); Retriever compacts what it has when its tool budget runs out |
| Token overflow      | Per-provider budget in Chunker                                                                                   |
| Cost blowout        | Rate limiting + max 5 concurrent agent runs                                                                      |

### 14.3 Cost

_Groq rows reflect Groq pricing before the switch to OpenRouter (2026-09). OpenRouter (Qwen3) per-query cost has not been measured yet; list price is ~$0.087 in / $0.35 out per M tokens. The Claude and Mistral estimates predate current prices (Haiku 4.5 $1 / $5, Mistral Small 4 $0.15 / $0.60 per M tokens)._

| Provider         | Est. Cost/Query | Monthly (100 queries/day)        |
| ---------------- | --------------- | -------------------------------- |
| Claude           | $0.02-0.08      | $60-240                          |
| Mistral          | $0.003-0.015    | $9-45                            |
| Groq             | $0.004-0.016    | $12-48                           |
| Groq (free tier) | $0              | $0 (capped ~200-300 queries/day) |
| HN APIs          | Free            | Free                             |
| Infrastructure   | $0 (dev)        | $5-20 (Railway/Fly)              |

### 14.4 Security

- API keys in `.env`, never committed. `.env.example` with placeholders.
- Rate limiting on the query and narration endpoints from day one (60 req/min each, global).
- The live LLM health probe (`/api/health/llm`) is cached for 60 s so it cannot be used to run up provider costs.
- No auth in v1 (single-user local tool).
- Input sanitization + max query length (500 chars).
- All HN data is public. No PII concerns.

---

## 15. Roadmap

### v1.0 -- Foundation (Shipped)

- [x] Nx monorepo scaffold
- [x] HN API service (Algolia + Firebase)
- [x] In-memory caching layer (node-cache; now lru-cache)
- [x] Content chunker with per-provider token budgeting (budgets not currently applied by the tools; see 6.2)
- [x] LLM provider interface + triple-stack (Claude, Mistral, Groq; Groq later replaced by OpenRouter)
- [x] Native tool_result protocol per provider (via LangChain)
- [x] ReAct agent loop (plan, act, observe, respond)
- [x] RAG endpoints (POST + SSE) with rate limiting
- [x] Evaluation harness (20 test queries)
- [x] Angular chat UI with live agent step visualization
- [x] Source cards with HN links
- [x] Provider selector in UI
- [x] Meta bar (provider, tokens, latency, cached)
- [x] TtsModule (ElevenLabs streaming TTS; later replaced by Mistral Voxtral, ADR-008)
- [x] Podcast rewrite prompt + LLM call
- [x] Audio player component with Listen button
- [x] Playback speed controls + MP3 download
- [x] Trust metadata on AgentResponse (source verification, recency, diversity)
- [x] Trust bar UI component
- [x] Trust-specific eval queries (7 queries)
- [x] ElevenLabs TTS integration (TtsService + streaming endpoint; later replaced by Mistral Voxtral)
- [x] Podcast script rewriter (LLM-powered text-to-speech preprocessing)
- [x] Listen button + audio player component
- [x] Signature narrator voice configuration

### v1.1 -- Polish

- [ ] Loading skeleton UI
- [x] Dark mode (light/dark toggle; dark is the default)
- [ ] Mobile responsive layout
- [ ] Error boundary components
- [ ] Provider auto-fallback
- [ ] Query history (local storage)
- [ ] Waveform visualization on audio player
- [ ] Audio caching (same narration if answer unchanged)
- [ ] Voice selector (2-3 preset voices)
- [ ] "Podcast mode" toggle (auto-narrate every answer)
- [x] Voice: playback speed controls (0.75x, 1x, 1.25x, 1.5x)
- [x] Voice: downloadable MP3 of narrated answer

### v2.0 -- Multi-Agent Pipeline (Complete)

- [x] Shared types: EvidenceBundle, AnalysisResult, AgentResponse v2, PipelineConfig
- [x] RetrieverAgent: ReAct loop + compaction
- [x] SynthesizerAgent: single-pass analysis
- [x] WriterAgent: single-pass prose composition
- [x] OrchestratorService: LangGraph StateGraph pipeline coordination + SSE events
- [x] Shared `invokeWithRetry` utility across all pipeline nodes (exponential backoff, TPM detection)
- [ ] PipelineConfig presets: optimized, speed, cost (default preset using global provider is live)
- [x] Pipeline is default mode: frontend always passes `useMultiAgent: true`
- [x] Fallback to legacy ReAct on pipeline error
- [x] Angular: PipelineEvent SSE integration in agent steps timeline
- [x] Frontend UX hardening: sticky header, cancel button, stall detection (300s), background-resilient timer
- [x] SSE background tab recovery: kill stale subscription, fetch stored result by queryId, reconnect if still running
- [x] Backend query deduplication for in-flight agent runs
- [x] 3-state SSE connection machine (streaming/done/error) replacing 8-state model
- [x] Shared handleStreamEvent() for submit and reconnect paths
- [x] Query result endpoint 202 response returns full QueryResult shape with compile-time enforcement
- [x] Pipeline fallback tracks completed stages, only marks incomplete stages as error
- [x] Integration tests: 60+ new tests
- [ ] Eval harness: multi-agent vs single-agent comparison

### Shipped since v3.2 (October 2026)

Not part of the original roadmap; listed here so the spec matches the product.

- [x] Pipeline latency cut roughly in half: sources recorded by the tools instead of transcribed by the model, Retriever output cap, level-by-level comment fetching (ADR-009)
- [x] Live answer draft streamed while the Writer runs (3.9)
- [x] Follow-up questions that reuse the previous answer's evidence (3.10)
- [x] Instant replay of repeated questions for 15 minutes, with a "cached" badge (3.6)
- [x] Every source dated from the HN API (3.4)
- [x] Honest confidence on thin evidence: search filter relaxation, confidence cap, gap note (3.11)
- [x] Lenient compaction parsing so one malformed theme no longer discards a whole query
- [x] Clear error when an LLM API key is rejected, no wasted fallback run (3.12)
- [x] `GET /api/health/llm` live provider check for operators (7.5)
- [x] Narration fixes for mobile: Xing header for correct duration, iOS audio unlock (3.8)
- [x] Opt-in merged writer mode, `PIPELINE_MERGED_WRITER=true` (ADR-010)
- [x] Eval harness scores the pipeline over SSE by default, with current prices, latency summaries and `--baseline` comparisons
- [ ] Merged writer on by default (pending a second full eval run)

### v2.1 -- Intelligence Upgrade

- [ ] Conversation memory (multi-turn)
- [ ] Semantic search (embeddings + Qdrant)
- [ ] Follow-up suggestions
- [ ] WebSocket upgrade
- [ ] Scheduled digests
- [ ] Downloadable podcast episodes (batch answers into one MP3)
- [ ] RSS podcast feed (subscribe in podcast apps)
- [ ] Voice input (STT via Mistral Voxtral transcription)
- [ ] Two-voice dialogue mode (host + guest debating HN opinions)
- [ ] Voice: auto-play podcast mode (toggle in settings)
- [ ] Voice: user-selectable voice library
- [ ] Voice: RSS podcast feed (subscribe in podcast apps)

### v3.0 -- Platform

- [ ] Multi-source RAG (Reddit, Stack Overflow, GitHub Discussions)
- [ ] User accounts + saved queries
- [ ] Bring-your-own API key
- [ ] Plugin system (Jira, Slack, Notion)
- [ ] Redis cache for multi-instance

---

## 16. Success Metrics

_Groq latency targets were set before the switch to OpenRouter (2026-09)._

| Metric                   | Target                         | How to Measure              |
| ------------------------ | ------------------------------ | --------------------------- |
| **Answer relevance**     | 80%+ "helpful"                 | Thumbs up/down in UI        |
| **Source accuracy**      | 0 hallucinated per 100 queries | Eval harness (automated)    |
| **Quality pass rate**    | 75%+ across eval queries       | Eval harness (LLM-as-judge) |
| **Agent efficiency**     | Avg 3.2 steps/query            | Log analysis                |
| **P50 latency (Groq)**   | < 6s                           | Timing middleware           |
| **P50 latency (Claude)** | < 13s                          | Timing middleware           |
| **P95 latency (all)**    | < 30s                          | Timing middleware           |
| **Cost/query (Mistral)** | < $0.02 avg                    | Usage dashboard             |
| **Cache hit rate**       | > 15% after week 1             | CacheService stats          |

---

## 17. Getting Started

### Prerequisites

- Node.js 22
- pnpm 10 (`corepack enable`)
- At least one LLM API key:
  - OpenRouter: [openrouter.ai/keys](https://openrouter.ai/keys)
  - Mistral: [console.mistral.ai](https://console.mistral.ai)
  - Anthropic: [console.anthropic.com](https://console.anthropic.com)

### Setup

```bash
git clone https://github.com/your-username/voxpopuli.git
cd voxpopuli
pnpm install

cp .env.example .env
# Add at least one API key, set LLM_PROVIDER (default: mistral)

pnpm exec nx serve api     # Terminal 1: backend on :3000
pnpm exec nx serve web     # Terminal 2: frontend on :4200

# Check the provider key works
curl http://localhost:3000/api/health/llm

# Test
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What does HN think about the best programming fonts?"}'

# Run evals
pnpm exec tsx evals/run-eval.ts
```

---

## 18. Contributing

### Areas Where Help Is Needed

| Area                            | Difficulty | Impact    |
| ------------------------------- | ---------- | --------- |
| More eval test queries          | Easy       | High      |
| Fourth LLM provider (OpenAI)    | Medium     | Medium    |
| "Saved answers" feature         | Medium     | High      |
| Semantic search with embeddings | Hard       | Very High |
| Reddit as second data source    | Medium     | High      |
| Provider auto-fallback logic    | Medium     | High      |

### Code Style

- TypeScript strict mode. No `any`.
- JSDoc on all public methods.
- Stateless services.
- Source notations for external API behavior.
- All LLM providers must implement `LlmProviderInterface`.

---

## 19. Voice Output (Mistral Voxtral TTS)

### 19.1 Overview

When the agent finishes an answer, users can press a Listen button to hear it narrated in a podcast-style voice. The answer is rewritten into conversational speech, sent to Mistral Voxtral TTS, and returned to the browser as a complete MP3.

### 19.2 Pipeline

```
1. Agent produces answer (markdown text with citations)
2. User clicks "Listen"
3. POST /api/tts/narrate { text, rewrite?, voiceId? }
4. TtsService.narrate(text, { rewrite, voiceId }):
   a) Podcast Rewrite (rewriteForSpeech, LLM call via LlmService):
      - Strip markdown, links, code blocks
      - Convert citations to spoken references
      - Add opening hook + sign-off ("VoxPopuli, signing off.")
      - Cap at 2500 characters
   b) Voxtral TTS (synthesize(script, voice?)):
      - Native fetch: POST https://api.mistral.ai/v1/audio/speech
        { model, input, voice_id, response_format: "mp3" }
      - Response: JSON { audio_data: <base64 MP3> } (non-streaming)
      - Decode base64 -> Buffer
   c) Return { audio, contentType: "audio/mpeg", characterCount }
5. Controller sends the complete MP3 (Content-Length set, no chunking)
6. Frontend: HTML5 <audio> plays the downloaded file
```

### 19.3 Signature Voice

**Default: `en_paul_neutral`** (preset "Paul - Neutral")

- Relaxed, balanced, neutral delivery; US English
- One of 30 Voxtral preset voices (e.g. `en_paul_*`, `gb_oliver_*`, `gb_jane_*`, `fr_marie_*`)
- Override globally with `MISTRAL_TTS_VOICE`, or per request with `voiceId`

**Available voices:** List presets with `GET https://api.mistral.ai/v1/audio/voices`. Custom voices, created by zero-shot cloning from a 2-3 second sample, are referenced by UUID. Voxtral supports 9 languages.

**Request sent to Mistral:**

```typescript
{
  model: "voxtral-mini-tts-latest",
  input: script,                 // Podcast-rewritten text, <= 2500 chars
  voice_id: "en_paul_neutral",
  response_format: "mp3"
}
```

**Output:** 22.05 kHz mono MP3.

**Measured performance:**

| Input                                                 | Audio length | MP3 size | Time   |
| ----------------------------------------------------- | ------------ | -------- | ------ |
| Short line                                            | --           | --       | ~0.6 s |
| 2,500-char script                                     | ~108 s       | ~960 KB  | ~10 s  |
| Full `/api/tts/narrate` (short answer, incl. rewrite) | --           | --       | ~4 s   |

### 19.4 API Endpoints

**POST `/api/tts/narrate`**

Request:

```typescript
{ text: string; rewrite?: boolean; voiceId?: string; }
```

Response: complete MP3 with headers `Content-Type: audio/mpeg`, `Content-Length`, and `X-TTS-Characters`. The audio is buffered rather than chunked for reverse-proxy compatibility.

Errors:

- 400: empty text, text over 10,000 chars, or `voiceId` not matching `/^[A-Za-z0-9_-]{1,64}$/`
- 429: rate limit (60 req/min)
- 502: Voxtral/Mistral upstream error (`TtsUpstreamError`); the message includes Mistral's reason, e.g. unknown voice
- 500: other failures

See Section 7.3 for the full request/response reference.

**GET `/api/tts/voices`** -- Returns the active narrator as a `VoiceConfig`:

```json
{ "id": "en_paul_neutral", "name": "en_paul_neutral", "model": "voxtral-mini-tts-latest" }
```

### 19.5 Podcast Rewrite Example

**Raw agent answer:**

```
Based on HN discussions, **Tailwind v4** has been broadly well-received.
A [highly upvoted story](https://...) by user `swyx` (340 points) praised
the new Oxide engine. However, `tptacek` argued that utility-first CSS
creates maintenance debt at scale (127 upvotes).
```

**After podcast rewrite:**

```
So, here's what the Hacker News crowd has to say about Tailwind v4.
The reception has been broadly positive. A highly upvoted post by swyx,
with over 340 points, praised the new Oxide engine for some serious
speed improvements. But not everyone's on board. A commenter named
tptacek argued that utility-first CSS creates maintenance debt at scale.
That's the signal from Hacker News. VoxPopuli, signing off.
```

### 19.6 Frontend: Audio Player

States: `idle` (Listen button) -> `loading` -> `playing` -> `paused` -> `complete` (listen again + download), plus `error`.

Controls: play/pause, progress bar, speed (0.75x / 1x / 1.25x / 1.5x), download MP3.

### 19.7 New Module

```
TtsModule
+-- TtsService
|   +-- narrate(text, { rewrite?, voiceId? })
|   |     -> { audio: Buffer, contentType: 'audio/mpeg', characterCount }
|   +-- rewriteForSpeech(text) -> string (LLM call via LlmService)
|   +-- synthesize(script, voice?) -> Buffer (Mistral Voxtral, native fetch)
+-- TtsController
    +-- POST /api/tts/narrate
    +-- GET  /api/tts/voices
```

### 19.8 New Dependencies and Config

No new npm dependency. `TtsService` calls the Mistral speech endpoint with Node's native `fetch`. (The `elevenlabs` package used by the earlier implementation was removed.)

```env
MISTRAL_API_KEY=...                         # Same key as the Mistral LLM provider
MISTRAL_TTS_MODEL=voxtral-mini-tts-latest   # Optional, this is the default
MISTRAL_TTS_VOICE=en_paul_neutral           # Optional, this is the default
```

### 19.9 Cost Impact

Per narration: one small LLM rewrite call plus Voxtral usage for up to 2,500 script characters. Voxtral usage is billed per [Mistral pricing](https://mistral.ai/pricing); there is no separate TTS subscription or credit plan.

### 19.10 Risks

| Risk                                       | Mitigation                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Generation latency (~10 s for 2,500 chars) | Show "Preparing narration..." loading state                                            |
| No streaming playback                      | Full MP3 is buffered; acceptable at ~1 MB max per narration                            |
| Mistral upstream error or quota issue      | Surface as 502 with Mistral's reason; player shows error state                         |
| Rewrite hallucination                      | Eval check: compare rewrite against original answer                                    |
| Long answers                               | Rewrite caps script at 2,500 chars; input text capped at 10,000                        |
| Unknown or removed voice ID                | 502 with Mistral's reason; unset `MISTRAL_TTS_VOICE` to fall back to `en_paul_neutral` |

---

## 20. License

MIT

---
