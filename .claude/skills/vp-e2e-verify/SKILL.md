---
name: vp-e2e-verify
description: Use when a VoxPopuli change touches an LLM provider, TTS, the agent/pipeline, or streaming and must be proven against real services before a PR, or when the user asks for an e2e test, a smoke test, or to "try it for real"
---

# End-to-End Verification (VoxPopuli)

## Overview

Mocked unit tests can't catch provider behaviour: slow hosts, `max_tokens` overflows, models sending `"10"` for numbers, account policy blocks (e.g. OpenRouter ZDR). Verify on **your own isolated instances** so you never kill or restart the user's dev servers on :3000/:4200.

## 1. Start Isolated Instances

```bash
# API: build, then run the bundle directly on :3100 (bypasses `nx serve`, so no "another nx process" lock)
pnpm exec nx build api
set -a && source .env && set +a
LLM_PROVIDER=openrouter PORT=3100 NODE_ENV=development node apps/api/dist/main.js > "$SCRATCH/api3100.log" 2>&1   # run in background

# Web on :4300, proxied to your API (write the proxy file in your scratch dir, not the repo)
printf '{ "/api/**": { "target": "http://localhost:3100", "secure": false } }\n' > "$SCRATCH/proxy3100.json"
pnpm exec nx serve web --port 4300 --proxy-config "$SCRATCH/proxy3100.json"                                      # run in background
```

- Keys come from `.env`. Check that one is present without printing it: `grep -c '^MISTRAL_API_KEY=.' .env`. Never echo key values.
- Don't override a key that `.env` already sets (`export X="$UNSET_VAR"` blanks it). Confirm the log shows `Active LLM provider: …`.

## 2. Exercise the Real Paths

```bash
curl -sN "localhost:3100/api/rag/stream?query=What%20does%20HN%20think%20about%20htmx%3F&provider=openrouter&useMultiAgent=true" > "$SCRATCH/stream.txt"
curl -s -X POST localhost:3100/api/rag/query -H 'Content-Type: application/json' -d '{"query":"…","provider":"openrouter"}'
curl -s -X POST localhost:3100/api/tts/narrate -H 'Content-Type: application/json' -d '{"text":"…","rewrite":true}' -D - -o "$SCRATCH/out.mp3"
```

What to check:

| Area   | Pass criteria                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------ |
| Stream | `pipeline` events for retriever → synthesizer → writer all `done`; one `answer`; no `error` event      |
| Answer | `meta.provider` correct, token counts > 0, sources > 0, trust metadata present                         |
| Tools  | `grep -c "did not match expected schema\|Pipeline failed" api3100.log` returns 0                       |
| TTS    | 201, `Content-Type: audio/mpeg`, `X-TTS-Characters`; `file out.mp3` says MPEG; bad voice gives 400/502 |

Then drive the UI on :4300 with Playwright: submit a query, wait for the answer, click **Listen**. The audio player keeps its `Audio` object in memory, not in the DOM, so check the player's own UI state ("Now playing" / "Finished" and a duration) rather than looking for an `<audio>` element. Poll with `browser_run_code` loops, because `browser_wait_for` times out after 5 s.

## 3. When a Provider Call Fails

Call the provider directly with `curl` or a tiny `tsx` script to get the raw upstream error body before you change code. OpenRouter wraps host errors as `Provider returned error`, with the real cause in `error.metadata.raw`. Classify the failure:

- **Our request is wrong** (e.g. a missing `max_tokens`): fix the code.
- **Account or policy restriction** (e.g. ZDR guardrails): report it to the user. Don't change their settings.
- **Model or host too slow or flaky:** benchmark alternatives with `curl`, then let the user choose.

## 4. Clean Up

```bash
kill $(lsof -ti:3100,4300); pkill -f "nx serve web --port 4300"
```

Close the browser and delete any screenshots you saved into the repo (e.g. `.playwright-mcp/*.png`).

## Common Mistakes

- Running `nx serve api` while the user's server is up; it collides, and killing it kills their work
- Treating a stale Playwright snapshot as a real UI state; re-snapshot after waits
- Adding a "skipped" Jest spec that hits the real API instead of doing this
