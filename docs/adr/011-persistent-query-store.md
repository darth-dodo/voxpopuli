# ADR-011: Optional Redis Backend for the Query Store

**Status:** Accepted (opt-in via `REDIS_URL`; in-memory remains the default)
**Date:** 2026-10-04
**Deciders:** Abhishek Juneja
**Extends:** ADR-007 (query-ID resilience)

## Context

ADR-007 moved result delivery off the SSE connection into `QueryStore`, but noted the catch:
`CacheService` is a per-process `lru-cache`. The API runs as a single Render starter instance, so
every deploy or restart wipes:

- completed answers replayed to identical questions (15 min, `COMPLETED_TTL`),
- follow-up evidence (`PriorEvidence`, 30 min, `EVIDENCE_TTL`),
- the results behind `GET /api/rag/query/:id/result`.

A user who submits a question just before a deploy, backgrounds the tab and returns gets a 404, and
"Ask a follow-up" silently turns into a fresh HN search.

## Decision

Add a small `KeyValueStore` abstraction (`apps/api/src/cache/key-value-store.ts`) with two
implementations, chosen at boot by `REDIS_URL`:

| `REDIS_URL` | Store                 | Behavior                                                     |
| ----------- | --------------------- | ------------------------------------------------------------ |
| unset       | `MemoryKeyValueStore` | Exactly as before: everything in the process-local LRU       |
| set         | `RedisKeyValueStore`  | `ioredis`, JSON values, native `SET … EX` TTLs, `vp:` prefix |

`QueryStore` keeps two layers:

1. **Process-local (`CacheService`, synchronous)** — still the source of truth for this process.
   Running entries with their buffered events and steps live here, and the SSE attach path
   (`pollExistingQuery`) polls them.
2. **Durable (`KeyValueStore`, async)** — a write-through copy, skipped entirely for the in-memory
   store. Reads fall back to it only on a local miss.

What is written to Redis:

| Key                | Written by      | TTL    | Contents                                     |
| ------------------ | --------------- | ------ | -------------------------------------------- |
| `vp:query:<id>`    | `create()`      | 5 min  | Running marker (no events/steps)             |
| `vp:query:<id>`    | `complete()`    | 15 min | Full `QueryResult`                           |
| `vp:query:<id>`    | `fail()`        | 5 min  | Failed `QueryResult`                         |
| `vp:dedup:<hash>`  | `create()`      | 15 min | queryId for the normalized query + store key |
| `vp:evidence:<id>` | `setEvidence()` | 30 min | `PriorEvidence` for follow-ups               |

Events and steps appended while running are **not** written per event; they reach Redis once, inside
the completed result. This keeps Redis traffic at a handful of writes per query.

### What is and isn't shared across processes

| Capability                                       | Survives restart / shared with Redis | Notes                                                                                       |
| ------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `GET /query/:id/result` for a finished run       | Yes                                  | 200 with the stored result                                                                  |
| `GET /query/:id/result` for a running run        | Partly                               | Another process sees the marker and returns 202 with empty `pipelineEvents`/`steps`         |
| Replay of a completed identical question         | Yes                                  | Found via `vp:dedup`, copied into the local cache, replayed with `meta.cached: true`        |
| Follow-up evidence                               | Yes                                  | `getEvidence()` falls back to Redis                                                         |
| Attaching to an in-flight run                    | **No**                               | Live events exist only in the process running the agent; another process starts a fresh run |
| `POST /api/rag/query` 10-min cache, HN API cache | **No**                               | Still in-process `CacheService`; cheap to rebuild                                           |

A run interrupted by a restart leaves a running marker that answers 202 until it expires (5 min).
The frontend's reconnect then starts a fresh run, which is the same outcome as before this change.

### Failure handling

Redis must never take a query down. The client is created with `enableOfflineQueue: false`,
`maxRetriesPerRequest: 1`, `commandTimeout: 1000` ms and a capped reconnect backoff, so commands fail
fast while Redis is unreachable. `RedisKeyValueStore` catches every error: reads become misses,
writes are dropped, and warnings are throttled to one per 30 s. An `error` listener is registered so
connection errors cannot crash the process. Writes are fire-and-forget, so they add no latency to
the stream.

### Client choice

`ioredis` (MIT, maintained under the `redis` GitHub org): first-class TypeScript types, built-in
reconnect, per-command timeouts and key prefixes. `node-redis` would also work; ioredis's
`enableOfflineQueue`/`commandTimeout` options map directly onto the fail-fast requirement.

## Enabling on Render

`render.yaml` declares `REDIS_URL` with `sync: false` but does not provision a store (Key Value is a
separate resource with its own plan). To enable:

1. Render dashboard → **New → Key Value** in the same region as `voxpopuli-api`; the free plan is
   enough (data here is short-lived and rebuildable). Choose `allkeys-lru` as the eviction policy.
2. Copy its **Internal Key Value URL** (`redis://red-…:6379`).
3. Set it as `REDIS_URL` on `voxpopuli-api` (or the `voxpopuli-secrets` group) and redeploy.
4. Logs show `REDIS_URL set — persisting query results to Redis`.

Note that Render's free Key Value is itself in-memory without persistence, so it survives API
deploys and restarts but not a restart of the Key Value instance. That is the gap this ADR closes.

## Consequences

**Positive:** deploys no longer lose recent answers or follow-up evidence; the result endpoint works
across restarts; a future multi-instance setup gets shared replay and result lookup for free.

**Negative:** an optional new dependency (`ioredis`) and moving parts; `findReusable()`,
`getEvidence()` and the result lookup are now async, so the SSE handlers resolve them inside
`defer()`; two simultaneous identical questions on a cold local cache can both start a run during
the Redis round trip (milliseconds).

**Neutral:** with `REDIS_URL` unset nothing changes — local dev, tests and CI need no Redis.
