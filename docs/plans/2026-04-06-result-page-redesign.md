# Result Page Redesign — Tabbed Layout

**Goal:** Replace the single-scroll result page with a tabbed layout (Answer / Sources / Steps) that gives each section full focus, removes the follow-up input, and makes agent steps human-readable.

**Branch:** `fix/restore-homepage-design`

---

## Design

### Header

- VoxPopuli logo (left, clickable → home) + "Voice of HackerNews" subtitle
- "+ New question" button (right) — resets to homepage
- Theme toggle (top-right corner, same as landing page)

### Tab Bar

Three tabs immediately below the header:

| Tab     | Label         | Default                                      |
| ------- | ------------- | -------------------------------------------- |
| Answer  | "Answer"      | Active by default after completion           |
| Sources | "Sources (N)" | N = source count                             |
| Steps   | "Steps (N)"   | N = step count, auto-active during streaming |

- Active tab has amber underline
- During SSE streaming, Steps tab auto-activates; switches to Answer when complete

### Answer Tab

- Full prose answer — NO truncation (remove `max-h-96` and "Show full answer")
- Markdown rendered via `ngx-markdown`
- Partial result warning banner above answer if applicable
- Thin divider below answer
- Trust badges row (existing TrustBarComponent)
- Thin divider
- Meta bar (provider, steps, time) in muted text

### Sources Tab

- 2-column grid (desktop), 1-column (mobile)
- All sources shown, no pagination
- Existing SourceCardComponent unchanged

### Steps Tab — Human-Readable

Each step rendered as a card:

- **Step number** label above the card
- **Human-readable summary** of what the agent did:
  - `search_hn(query: "X", ...)` → "Searched for X"
  - `get_story(id: N)` → "Fetched story: [title]"
  - `get_comments(storyId: N)` → "Fetched comments for [title]"
  - thought → thought text as-is
- **One-line result** in muted text (observation summary)
- **Icon per type:** search icon for search_hn, book icon for get_story/get_comments, thought bubble for thoughts
- **"Show raw" toggle** per step for debugging (shows original tool call syntax)

### Removed

- Sticky follow-up input bar (footer) — removed entirely
- Answer truncation (`max-h-96`, "Show full answer") — removed
- Collapsed/expanded steps toggle — replaced by Steps tab

---

## Components

| Component                   | Change                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `ChatComponent`             | Add tab state signal, remove footer, remove answer truncation, remove steps collapse logic       |
| `AgentStepsComponent`       | Rewrite to human-readable card format with step numbers, icons, summaries, and "Show raw" toggle |
| `SourceCardComponent`       | No changes                                                                                       |
| `TrustBarComponent`         | No changes                                                                                       |
| `MetaBarComponent`          | No changes                                                                                       |
| `ProviderSelectorComponent` | No changes (not shown on result page)                                                            |
