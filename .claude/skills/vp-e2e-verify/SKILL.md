---
name: vp-e2e-verify
description: Use when a VoxPopuli change touches an LLM provider, TTS, the agent/pipeline, or streaming and must be proven against real services before a PR, or when the user asks for an e2e test, a smoke test, or to "try it for real"
---

# End-to-End Verification (VoxPopuli)

## Overview

Mocked unit tests can't catch provider behaviour: slow hosts, `max_tokens` overflows, models sending `"10"` for numbers, account policy blocks (e.g. OpenRouter ZDR). Verify on **your own isolated instances** so you never kill or restart the user's dev servers on :3000/:4200, or another session's verification servers.

Pick ports nobody else is likely to use (other sessions often run this same skill), check they are free, and record the PIDs you start so cleanup touches only your processes.

## 1. Start Isolated Instances

```bash
# Pick unique ports and confirm nothing is listening on them
API_PORT=$((3100 + RANDOM % 800)); WEB_PORT=$((API_PORT + 1000))
lsof -iTCP:$API_PORT -sTCP:LISTEN; lsof -iTCP:$WEB_PORT -sTCP:LISTEN   # both must print nothing

# API: build, then run the bundle directly (bypasses `nx serve`, so no "another nx process" lock)
pnpm exec nx build api
set -a && source .env && set +a
LLM_PROVIDER=openrouter PORT=$API_PORT NODE_ENV=development node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
echo $! > "$SCRATCH/api.pid"

# Web, proxied to your API (write the proxy file in your scratch dir, not the repo)
printf '{ "/api/**": { "target": "http://localhost:%s", "secure": false } }\n' $API_PORT > "$SCRATCH/proxy.json"
pnpm exec nx serve web --port $WEB_PORT --proxy-config "$SCRATCH/proxy.json" > "$SCRATCH/web.log" 2>&1 &
echo $! > "$SCRATCH/web.pid"
```

Shell variables don't persist between tool calls; write the ports to `$SCRATCH` too, or substitute the literal numbers in later commands.

- Keys come from `.env`. Check that one is present without printing it: `grep -c '^MISTRAL_API_KEY=.' .env`. Never echo key values.
- Don't override a key that `.env` already sets (`export X="$UNSET_VAR"` blanks it). Confirm the log shows `Active LLM provider: …`.
- Confirm the key actually works before a long run: `curl -s localhost:$API_PORT/api/health/llm` returns `ok: true` (503 with `error: "auth"` means the key was rejected; the result is cached for 60 s).

## 2. Exercise the Real Paths

```bash
curl -sN "localhost:$API_PORT/api/rag/stream?query=What%20does%20HN%20think%20about%20htmx%3F&provider=openrouter&useMultiAgent=true" > "$SCRATCH/stream.txt"
curl -s -X POST localhost:$API_PORT/api/rag/query -H 'Content-Type: application/json' -d '{"query":"…","provider":"openrouter"}'
curl -s -X POST localhost:$API_PORT/api/tts/narrate -H 'Content-Type: application/json' -d '{"text":"…","rewrite":true}' -D - -o "$SCRATCH/out.mp3"
```

Identical questions (same provider and mode, ignoring case and whitespace) are replayed from the query store for 15 minutes with `meta.cached: true`, and `POST /rag/query` is cached for 10 minutes. After changing code, vary the question or restart your API, or you'll verify a replay.

To check follow-ups, take the `queryId` from the stream's `init` event and stream a second question with `&followUpOf=<queryId>`: the retriever `started` event should read "Reusing N sources from …" and the answer should arrive without a fresh HN search.

What to check:

| Area   | Pass criteria                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| Stream | `pipeline` events for retriever → synthesizer → writer all `done`; `token` draft events; one `answer`; no `error` event |
| Answer | `meta.provider` correct, token counts > 0, sources > 0, trust metadata present                                          |
| Tools  | `grep -c "did not match expected schema\|Pipeline failed" api.log` returns 0                                            |
| TTS    | 201, `Content-Type: audio/mpeg`, `X-TTS-Characters`; `file out.mp3` says MPEG; bad voice gives 400/502                  |

Then drive the UI on `$WEB_PORT` with Playwright: submit a query, wait for the answer, click **Listen**. The audio player keeps its `Audio` object in memory, not in the DOM, so check the player's own UI state ("Now playing" / "Finished" and a duration) rather than looking for an `<audio>` element. Poll with `browser_run_code` loops, because `browser_wait_for` times out after 5 s.

## 3. When a Provider Call Fails

Call the provider directly with `curl` or a tiny `tsx` script to get the raw upstream error body before you change code. OpenRouter wraps host errors as `Provider returned error`, with the real cause in `error.metadata.raw`. Classify the failure:

- **Our request is wrong** (e.g. a missing `max_tokens`): fix the code.
- **Account or policy restriction** (e.g. ZDR guardrails): report it to the user. Don't change their settings.
- **Model or host too slow or flaky:** benchmark alternatives with `curl`, then let the user choose.

## 4. Clean Up

Stop only the processes you started. Don't use `kill $(lsof -ti:<port>)`: `lsof -ti` also lists processes with _client_ sockets to that port (browsers, curl, other sessions' proxies), and a shared port number may belong to another session's server.

```bash
kill $(cat "$SCRATCH/api.pid") $(cat "$SCRATCH/web.pid")
pkill -f "nx serve web --port $WEB_PORT"   # the Angular dev server can outlive its nx parent
lsof -iTCP:$API_PORT -sTCP:LISTEN; lsof -iTCP:$WEB_PORT -sTCP:LISTEN   # both should print nothing
```

Close the browser and delete any screenshots you saved into the repo (e.g. `.playwright-mcp/*.png`).

## Common Mistakes

- Running `nx serve api` while the user's server is up; it collides, and killing it kills their work
- Reusing a fixed port like 3100 that another session may also be using, or cleaning up by port instead of by PID
- Re-running the same question after a code change and measuring a 15-minute replay
- Treating a stale Playwright snapshot as a real UI state; re-snapshot after waits
- Adding a "skipped" Jest spec that hits the real API instead of doing this
