# ADR-007: Query-ID Resilience — Decouple Result Delivery from SSE

**Status:** Accepted
**Date:** 2026-04-14
**Deciders:** Abhishek Juneja
**Linear:** AI-345 through AI-351

## Context

VoxPopuli streams agent responses via Server-Sent Events (ADR-005). The SSE connection is the sole delivery mechanism — if it drops, the result is lost and the user must retry from scratch, triggering a new LLM agent run.

Mobile browsers aggressively kill background connections:

- **iOS Safari**: Kills EventSource after ~30s in background. A confirmed WebKit bug causes `readyState` to report `OPEN` even when the connection is dead.
- **Android Chrome**: Throttles background tabs and kills connections on memory pressure.
- **Network transitions**: WiFi-to-cellular handoffs silently break EventSource without firing `onerror`.

Over M4 and M8 we built an 8-state connection machine in `RagService` with visibility-aware lifecycle management, stall detection (200s watchdog), exponential backoff (2 retries), null-data threshold handling, and heartbeat integration. Despite ~150 lines of resilience code, the fundamental problem persists: **users must keep the page in the foreground while the agent runs (30–180s)**. If they switch apps, they see "Connection lost. Tap retry" and the agent run is wasted.

This is the XY Problem — we kept asking "how to make SSE survive backgrounding" instead of "how to deliver results regardless of connection state."

## Decision

### Store results server-side, make SSE optional for live UX

Introduce a `QueryStore` service that caches agent results by `queryId`. The SSE stream emits a `queryId` as its first event. If the connection dies, the frontend fetches the completed result via `GET /api/rag/query/:id/result` instead of reconnecting SSE.

```
Before: Submit → SSE stream → must watch until done
After:  Submit → get queryId → SSE for live progress → fetch result anytime
```

### QueryStore (new service)

A thin layer over `CacheService` that manages query lifecycle:

- `create(query, provider)` → generates UUID, stores `{ status: 'running', ... }`, returns `queryId`
- `appendEvent(queryId, event)` → buffers pipeline events and steps during streaming
- `complete(queryId, response)` → stores final `AgentResponse`, sets `status: 'complete'`
- `fail(queryId, error)` → stores error, sets `status: 'error'`
- `get(queryId)` → returns stored `QueryResult` or undefined
- `findRunning(query, provider)` → deduplication check via hash index

TTL is 5 minutes — long enough for return-from-background, short enough to avoid cache bloat.

### New endpoint

```
GET /api/rag/query/:id/result
  → 200 QueryResult          (status: complete or error)
  → 202 { status: 'running', pipelineEvents, steps }  (agent still working)
  → 404 { message: 'Query not found or expired' }
```

### Frontend simplification

`ConnectionState` reduces from 8 states to 3: `streaming | done | error`. The visibility handler in `ChatComponent` changes from "try to reconnect SSE" to "fetch the result." ~150 lines of reconnection, backoff, null-data counting, and visibility-aware SSE management are deleted.

### SSE event flow change

One new SSE event type: `init` with `{ queryId }`, emitted as the first event. All subsequent events are also buffered into QueryStore as they're emitted, so the stored result includes the full event history.

### Alternatives considered

| Option                                    | Pros                                                                                                                      | Cons                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **QueryStore + fetch-on-return (chosen)** | Eliminates babysitting, reduces cost from duplicate runs, simplifies frontend, enables future features (history, sharing) | New service, +120 net lines, in-memory cache means results lost on restart                                       |
| **Service Worker SSE proxy**              | No backend changes, SW keeps connection alive                                                                             | SW can't hold long connections reliably on iOS, complex lifecycle management, doesn't solve the delivery problem |
| **WebSocket with reconnection**           | Bidirectional, better reconnection semantics                                                                              | Overkill for unidirectional streaming, NestJS SSE already works, new dependency                                  |
| **Long-polling fallback**                 | Simple, works everywhere                                                                                                  | Loses real-time UX, more server load from polling, doesn't solve result persistence                              |
| **`eventsource-client` library swap**     | Fixes iOS `readyState` bug (fetch-based transport)                                                                        | Only fixes 1 of 8 identified bugs, doesn't eliminate babysitting, new dependency                                 |
| **Harden existing state machine**         | No architecture change, fix specific bugs                                                                                 | Diminishing returns — each fix adds complexity, fundamental problem remains                                      |

QueryStore was chosen because:

1. **Solves the right problem.** The issue isn't "SSE connections die" — it's "results depend on connections." Storing results server-side breaks this coupling.
2. **Reduces complexity.** Deleting the reconnection state machine is a bigger win than making it more sophisticated.
3. **Eliminates duplicate costs.** No more wasted LLM runs from retry-on-reconnect.
4. **Enables natural extensions.** Query history, shareable links, TTS on stored results, and offline viewing all come naturally from having a result store.
5. **Minimal new surface area.** QueryStore is ~80 lines wrapping CacheService, which already handles TTL and eviction.

## Consequences

### Positive

- **No more babysitting.** Users can submit a query, switch apps, and return to a completed result.
- **Cost savings.** No duplicate LLM runs from reconnection retries or frustrated re-submits.
- **Code simplification.** ~150 lines of fragile state management replaced by ~80 lines of cache operations.
- **M5 readiness.** TTS voice output can reference stored results by queryId, independent of SSE lifecycle.
- **Query deduplication.** Identical in-flight queries share a single agent run via `findRunning()`.

### Negative

- **In-memory only.** `CacheService` uses `lru-cache` (per-process). Server restart or multi-node deployment loses stored results. Acceptable for MVP; Redis would fix without API changes.
- **5-minute window.** Results expire after 5 minutes. Sufficient for background-return, insufficient for "come back tomorrow." Extending TTL or adding persistence is a future concern.
- **New SSE event type.** The `init` event with `queryId` is a breaking change for any client that doesn't handle it. Since VoxPopuli controls both client and server, this is low risk.

### Neutral

- **SSE contract mostly unchanged.** Existing event types (`thought`, `action`, `observation`, `pipeline`, `token`, `answer`, `error`, `ping`) and their payloads are identical. Only addition is the `init` event at the start.
- **CacheService gets a `set()` method.** Currently only has `getOrSet()` and `get()`. Adding `set()` is a one-method change that doesn't affect existing callers.
- **`POST /query` also returns queryId.** The blocking endpoint stores results in QueryStore too, enabling consistent access patterns.
