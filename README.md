# VoxPopuli

[![CI](https://github.com/darth-dodo/voxpopuli/actions/workflows/ci.yml/badge.svg)](https://github.com/darth-dodo/voxpopuli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![NestJS](https://img.shields.io/badge/NestJS-11-red?style=flat-square&logo=nestjs)](https://nestjs.com)
[![Angular](https://img.shields.io/badge/Angular-21-dd0031?style=flat-square&logo=angular)](https://angular.dev)
[![Tests](https://img.shields.io/badge/Tests-198%20passing-brightgreen?style=flat-square)](.)
[![Coverage](https://img.shields.io/badge/Coverage-91%25-brightgreen?style=flat-square)](.)

> _"Voice of the People."_

**Ask anything about HackerNews. Get a sourced, reasoned answer -- with receipts.**

VoxPopuli is an agentic RAG system that turns 18+ years of [HackerNews](https://news.ycombinator.com) discussion into answers you can trust. It searches stories, reads comment threads, cross-references sources, and delivers a synthesized answer -- cited, verified, and transparent.

<p align="center">
  <img src="docs/screenshots/landing-dark-desktop.png" alt="VoxPopuli landing page - dark theme" width="720" />
</p>

<p align="center">
  <em>Dark theme with editorial typography and amber accents</em>
</p>

---

## How It Works

Ask a question in natural language. The agent runs a multi-step reasoning loop, searching HackerNews, reading comments, and synthesizing what it finds into a sourced answer.

```
You:   "Is SQLite good enough for production web apps?"

VoxPopuli:
  Searching for "SQLite production"           5 stories
  Searching for "SQLite scaling"              3 stories
  Reading comments #39482731                  28 comments
  Reading story #41205003                     loaded

  "HN is broadly positive, with caveats around write-heavy workloads.
   Specific projects like Litestream and Turso were frequently cited..."

  All 4 sources verified · Mostly recent sources · Multiple viewpoints
```

The agent loops up to 7 times using three tools:

- **search_hn** -- query stories with filters (points, date, relevance)
- **get_story** -- fetch full story details
- **get_comments** -- fetch comment trees (up to 30 comments, 3 levels deep)

---

## Screenshots

<table>
<tr>
<td width="60%">

**Desktop -- Dark Theme**

<img src="docs/screenshots/landing-full-dark.png" alt="Full landing page" width="100%" />

</td>
<td width="40%">

**Mobile**

<img src="docs/screenshots/landing-dark-mobile.png" alt="Mobile view" width="100%" />

</td>
</tr>
</table>

<p align="center">
  <img src="docs/screenshots/landing-light-desktop.png" alt="Light theme" width="720" />
</p>
<p align="center"><em>Light theme with warm, papery surfaces</em></p>

---

## Features

### Real-Time Reasoning

Every step streams to the UI as it happens. You see what the agent searches, what it finds, and when it decides to dig deeper. No black box.

### Trust Indicators

Every answer comes with verification metadata:

- **Sources verified** -- how many story IDs were confirmed
- **Recency** -- are sources from the last 12 months?
- **Viewpoint diversity** -- balanced, one-sided, or actively debated?
- **Show HN bias** -- flagged when the author has a vested interest

### Three LLM Providers

Pick your tradeoff. Switch from the UI.

| Provider                 | Best for               | Speed         |
| ------------------------ | ---------------------- | ------------- |
| **Groq** (Llama 3.3 70B) | Fast development       | ~300 tokens/s |
| **Mistral** Large 3      | Cost-optimized         | ~80 tokens/s  |
| **Claude** Sonnet 4      | Best synthesis quality | ~50 tokens/s  |

### Dark + Light Themes

Toggle between a dark OLED theme (optimized for eye comfort) and a warm light theme. Smooth CSS transitions.

---

## Getting Started

### Prerequisites

- Node.js >= 18, pnpm
- At least one LLM API key:
  - [Groq](https://console.groq.com) (free tier -- recommended for development)
  - [Mistral](https://console.mistral.ai)
  - [Anthropic](https://console.anthropic.com)

### Setup

```bash
git clone https://github.com/darth-dodo/voxpopuli.git
cd voxpopuli
pnpm install

cp .env.example .env
# Add at least one LLM API key, set LLM_PROVIDER=groq
```

### Run

```bash
# Terminal 1 -- Backend
npx nx serve api

# Terminal 2 -- Frontend (proxies /api/** to backend)
npx nx serve web --port 4201
```

Open [http://localhost:4201](http://localhost:4201) and ask a question.

### API Only

```bash
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What does HN think about Rust?"}'
```

---

## Architecture

| Layer        | Technology                                              |
| ------------ | ------------------------------------------------------- |
| Monorepo     | Nx                                                      |
| Backend      | NestJS 11 (TypeScript)                                  |
| Frontend     | Angular 21 (standalone components, signals)             |
| Design       | Tailwind CSS v4, "Data Noir Editorial" design system    |
| LLM          | Claude / Mistral / Groq via LangChain.js                |
| Streaming    | Server-Sent Events (SSE) with native EventSource        |
| Caching      | node-cache (in-memory, TTL-based)                       |
| Data         | HN Algolia API (search) + Firebase API (items/comments) |
| Markdown     | ngx-markdown + marked                                   |
| Shared types | `@voxpopuli/shared-types`                               |

### Frontend Components

| Component        | Purpose                                         |
| ---------------- | ----------------------------------------------- |
| ChatComponent    | Landing page + results page with SSE streaming  |
| AgentSteps       | Compact timeline with merged action/result rows |
| SourceCard       | Clickable HN story card with metadata           |
| TrustBar         | Human-friendly trust indicators                 |
| ProviderSelector | LLM provider chip selector                      |
| MetaBar          | Provider, tokens, human-readable latency        |

See [architecture.md](architecture.md) for the full technical blueprint and [product.md](product.md) for the product specification.

---

## Project Status

| Milestone                 | Status  | Highlights                                                |
| ------------------------- | ------- | --------------------------------------------------------- |
| M1: Scaffold & Data Layer | Done    | Nx monorepo, shared types, HN data + caching              |
| M2: LLM & Chunker         | Done    | Triple-stack LLM providers, token budgeting               |
| M3: Agent Core            | Done    | ReAct agent, RAG endpoints, trust framework               |
| M4: Frontend              | Done    | Chat UI, real-time streaming, design system, 91% coverage |
| M5: Voice Output          | Planned | ElevenLabs TTS with podcast-style narration               |
| M6: Eval Harness          | Planned | Automated quality scoring                                 |

**Current stats:** 198 tests passing (91 web + 107 API), 91% frontend coverage, 44 files in M4.

---

## Who Is This For?

| You are...                          | You ask...                                                         |
| ----------------------------------- | ------------------------------------------------------------------ |
| An **engineer** choosing tools      | "What does HN think about Bun vs Deno in 2026?"                    |
| A **founder** validating an idea    | "Has anyone built a competitor to Notion? What was the reception?" |
| A **researcher** tracking discourse | "How has sentiment on LLM agents changed over the past year?"      |
| Just **curious**                    | "What's the most controversial HN post about remote work?"         |

---

## Development

```bash
npx nx test              # Run all tests
npx nx test web          # Frontend tests (Vitest)
npx nx test api          # Backend tests (Jest)
npx nx lint              # Lint all projects
npx nx build api         # Build backend
npx nx build web         # Build frontend
npx nx test web --coverage  # Coverage report
```

---

## License

MIT
