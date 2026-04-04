# VoxPopuli

> _"Voice of the People."_

**Ask anything. Get the internet's smartest crowd-sourced answer, with receipts.**

VoxPopuli is an AI research agent that turns 18+ years of [Hacker News](https://news.ycombinator.com) discussion into answers you can actually use. It searches stories, reads comment threads, cross-references sources, and delivers a synthesized answer -- cited, sourced, and transparent. Then reads it to you like a podcast.

---

## The Problem

Hacker News is one of the richest knowledge bases on the internet. Engineers, founders, and researchers have spent nearly two decades debating tools, sharing war stories, and dissecting technical decisions. But that knowledge is effectively locked:

| What you want                                 | What you get today                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| "Best database for time-series data"          | Keyword results that miss threads about "storing sensor data efficiently" |
| The practitioner take on SQLite in production | A 400-comment thread where the best insight is at comment #247            |
| A synthesized view across 5 relevant threads  | Five browser tabs and an hour of reading                                  |

**The knowledge exists. The retrieval doesn't.**

---

## What VoxPopuli Does

### It reasons, not just retrieves

Most AI search tools: search once, stuff context, generate. VoxPopuli runs a multi-step reasoning loop. It reformulates queries based on initial results, decides whether to dive into comments, and cross-references multiple threads before answering.

```
You:   "Is SQLite good enough for production web apps?"

VoxPopuli:
  Step 1 -> Searches "SQLite production web app" (50+ point stories)
  Step 2 -> Searches "SQLite scaling limitations" (sorted by date)
  Step 3 -> Reads 28 comments from the highest-signal thread
  Step 4 -> Synthesizes answer from 3 sources + 28 comments

  "HN is broadly positive, with caveats around write-heavy workloads.
   Specific projects like Litestream and Turso were frequently cited..."
```

### You see the thinking

Every reasoning step streams to the UI in real time. You see what the agent searches, what it reads, and why it decides to dig deeper. Full transparency. No black box.

### Every answer has receipts

Story titles, authors, point counts, direct HN links, and commenter usernames for attributed opinions. You can verify anything the agent tells you.

### Listen to your answers

Click **Listen** on any answer and hear it narrated as a podcast. VoxPopuli rewrites the answer into conversational speech, streams it through ElevenLabs TTS, and plays it back with a signature narrator voice. Pour your coffee, put on your headphones, and catch up on what HN thinks.

### Trust indicators at a glance

Every answer comes with trust metadata: how many sources were verified, how recent they are, whether contrarian views were found, and whether Show HN posts (with author bias) are flagged. The agent distinguishes evidence from anecdote from opinion -- and tells you which is which.

---

## Who Is This For?

| You are...                          | You ask...                                                         |
| ----------------------------------- | ------------------------------------------------------------------ |
| An **engineer** choosing tools      | "What does HN think about Bun vs Deno in 2026?"                    |
| A **founder** validating an idea    | "Has anyone built a competitor to Notion? What was the reception?" |
| A **researcher** tracking discourse | "How has sentiment on LLM agents changed over the past year?"      |
| A **job seeker**                    | "What companies is HN excited about right now?"                    |
| Just **curious**                    | "What's the most controversial HN post about remote work?"         |

<details>
<summary><strong>20 example queries</strong></summary>

**Engineers:** Bun vs Deno vs Node for backends, Is Drizzle ORM production-ready, Best database for time-series IoT data, Monorepos vs polyrepos at scale.

**Founders:** Competitors to Notion and their reception, What developers hate about Stripe, Demand for open-source Figma alternative, Startup ideas HN keeps asking for.

**Researchers:** AI agent sentiment over 12 months, Emerging programming languages, Remote work opinions post-2025, HN reaction to every major OpenAI announcement.

**Career:** Best companies to work at per HN, Is Rust worth learning in 2026, Senior engineers on moving into management.

**Deep dives:** Most controversial HN post ever, Best system design books, Show HN projects that became real businesses, CS degree debate, The Node.js/io.js drama.

</details>

---

## How It Works

```
  Ask a question
       |
       v
  +-----------+     +-----------+     +-----------+
  |   THINK   | --> |    ACT    | --> |  OBSERVE  |
  | What do I |     | Search HN |     | Parse and |
  |   need?   |     | or fetch  |     |  evaluate |
  +-----------+     | comments  |     |  results  |
       ^            +-----------+     +-----+-----+
       |                                    |
       +------------ need more? ------------+
                                            |
                                     enough signal
                                            |
                                            v
                                  Sourced, cited answer
                                            |
                                            v
                                    [> Listen] (optional)
                                            |
                                            v
                                   Podcast-style narration
```

The agent loops up to 7 times, using three tools:

- **Search HN** -- query stories with filters (points, date, relevance)
- **Get Story** -- fetch full story details from Firebase
- **Get Comments** -- fetch comment trees (up to 30 comments, 3 levels deep)

The LLM decides which to call, when, and in what order.

---

## Three Providers, One Interface

Pick your tradeoff. Switch with a single environment variable.

| Provider                 | Best for                  | Speed         | Cost/query      |
| ------------------------ | ------------------------- | ------------- | --------------- |
| **Groq** (Llama 3.3 70B) | Development + free tier   | 300+ tokens/s | $0 - $0.016     |
| **Mistral** Large 3      | Cost-optimized production | ~80 tokens/s  | $0.003 - $0.015 |
| **Claude** Sonnet 4      | Best synthesis quality    | ~50 tokens/s  | $0.02 - $0.08   |

All three use native tool calling protocols via [LangChain.js](https://js.langchain.com/). Zero code changes to switch.

---

## Getting Started

### Prerequisites

- Node.js >= 18, npm >= 9
- At least one LLM API key:
  - [Groq](https://console.groq.com) (free tier available -- recommended for development)
  - [Mistral](https://console.mistral.ai)
  - [Anthropic](https://console.anthropic.com)
- Optional: [ElevenLabs](https://elevenlabs.io) API key for voice output

### Setup

```bash
git clone https://github.com/darth-dodo/voxpopuli.git
cd voxpopuli
npm install

cp .env.example .env
# Add at least one LLM API key, set LLM_PROVIDER=groq
```

### Run

```bash
npx nx serve api     # Backend on :3000
npx nx serve web     # Frontend on :4200
```

### Try it

```bash
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What does HN think about the best programming fonts?"}'
```

---

## What You Get Back

Every response includes:

- **Answer** -- synthesized, cited, with trust indicators
- **Reasoning steps** -- the full chain of what the agent searched, read, and decided
- **Sources** -- deduplicated story list with titles, authors, points, and HN links
- **Trust metadata** -- source verification, recency, viewpoint diversity, bias flags
- **Meta** -- which provider was used, tokens consumed, latency, cache status

---

## Voice Output

Click **Listen** on any answer. VoxPopuli:

1. Rewrites the answer into a podcast-style script (strips markdown, naturalizes citations, adds conversational transitions)
2. Streams it through ElevenLabs TTS with a signature narrator voice
3. Plays audio in-browser with speed controls (0.75x - 1.5x) and MP3 download

The sign-off: _"That's the signal from Hacker News. I'm VoxPopuli."_

---

## Architecture

| Layer        | Technology                                              |
| ------------ | ------------------------------------------------------- |
| Monorepo     | Nx                                                      |
| Backend      | NestJS (TypeScript)                                     |
| Frontend     | Angular 17+ (standalone components, signals)            |
| LLM          | Claude / Mistral / Groq via LangChain.js                |
| Voice        | ElevenLabs TTS (Multilingual v2)                        |
| Caching      | node-cache (in-memory, TTL-based)                       |
| Data         | HN Algolia API (search) + Firebase API (items/comments) |
| Streaming    | Server-Sent Events (SSE)                                |
| Shared types | `@voxpopuli/shared-types` (single source of truth)      |

See [product.md](product.md) for the full product specification and [architecture.md](architecture.md) for the technical blueprint.

---

## Project Status

| Milestone                 | Status  | What it delivers                                                   |
| ------------------------- | ------- | ------------------------------------------------------------------ |
| M1: Scaffold & Data Layer | Done    | Nx monorepo, shared types, HN data flowing with caching            |
| M2: LLM & Chunker         | Done    | Triple-stack LLM providers, chunker with token budgeting, 51 tests |
| M3: Agent Core            | Up Next | ReAct reasoning loop, sourced answers via API                      |
| M4: Frontend              | Planned | Chat UI with live reasoning visualization                          |
| M5: Voice Output          | Planned | ElevenLabs TTS with podcast-style narration                        |
| M6: Eval Harness          | Planned | 20 test queries, automated scoring                                 |

---

## License

MIT
