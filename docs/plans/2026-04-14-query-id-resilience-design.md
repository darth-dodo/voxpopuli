# Query-ID Resilience: Decouple Result Delivery from SSE

**Date**: 2026-04-14
**Milestone**: M4 (Frontend) + M9 (Code Review Hardening)
**Linear Issues**: AI-345 through AI-351
**Branch**: `feature/query-id-resilience`

## Problem

Mobile browsers aggressively kill background SSE connections (iOS Safari after ~30s, Android Chrome via tab throttling). VoxPopuli's current architecture treats the SSE connection as the delivery mechanism — if it dies, the result is lost and the user must retry from scratch. Each retry triggers a new LLM agent run, wasting cost and time.

The existing RagService has an 8-state connection machine with visibility handling, stall detection, exponential backoff, and null-data counters. Despite this complexity (~150 lines), the fundamental problem remains: **you must babysit the page while it loads**.

## Solution

Decouple result delivery from the SSE connection. Store agent results server-side by `queryId`. When the user returns from background, fetch the result via HTTP instead of reconnecting SSE.

```
Before: Submit → SSE stream → must watch until done
After:  Submit → get queryId → SSE for live progress (optional) → fetch result anytime
```

The SSE stream becomes optional live UX for watching progress. The HTTP endpoint becomes the reliable delivery mechanism.

## Architecture

### New Types (shared-types)

```typescript
/** Stored query result, retrievable by queryId. */
export interface QueryResult {
  queryId: string;
  status: 'running' | 'complete' | 'error';
  response: AgentResponse | null;
  pipelineEvents: PipelineEvent[];
  steps: AgentStep[];
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

/** Pipeline event stored alongside the result. */
export interface PipelineEvent {
  stage: string;
  status: string;
  detail: string;
  elapsed: number;
}
```

### Backend Changes

#### 1. QueryStore (new service, or extend CacheService)

A thin layer over CacheService that manages query lifecycle:

```typescript
@Injectable()
export class QueryStore {
  constructor(private readonly cache: CacheService) {}

  /** Create a new query entry. Returns the queryId. */
  create(query: string, provider: string): string {
    const queryId = randomUUID();
    const entry: QueryResult = {
      queryId,
      status: 'running',
      response: null,
      pipelineEvents: [],
      steps: [],
      error: null,
      createdAt: Date.now(),
      completedAt: null,
    };
    this.cache.set(`query:${queryId}`, entry, QUERY_TTL);
    // Dedup index: hash(query+provider) → queryId
    this.cache.set(`dedup:${this.dedupKey(query, provider)}`, queryId, QUERY_TTL);
    return queryId;
  }

  /** Append a pipeline event. */
  appendEvent(queryId: string, event: PipelineEvent): void { ... }

  /** Append an agent step. */
  appendStep(queryId: string, step: AgentStep): void { ... }

  /** Mark complete with the final response. */
  complete(queryId: string, response: AgentResponse): void { ... }

  /** Mark failed with error message. */
  fail(queryId: string, error: string): void { ... }

  /** Get the stored result. */
  get(queryId: string): QueryResult | undefined { ... }

  /** Check if an identical query is already running. Returns queryId or null. */
  findRunning(query: string, provider: string): string | null { ... }
}
```

**TTL**: 5 minutes. Agent runs take 30-180s; 5 min covers return-from-background with margin.

**CacheService changes needed**: Add a `set()` method (currently only has `getOrSet()` and `get()`). The existing LRU cache and TTL support in `lru-cache` already handle expiry.

#### 2. RagController Changes

**New endpoint**:

```
GET /api/rag/query/:id/result
  → 200 { ...QueryResult }        (complete or error)
  → 202 { ...QueryResult }        (still running — full QueryResult shape with response: null, error: null, completedAt: null)
  → 404 { message: 'Query not found or expired' }
```

**Modified SSE stream endpoint**:

- Generate `queryId` at stream start
- Emit `queryId` as first SSE event: `type: 'init', data: { queryId }`
- Buffer all events into QueryStore as they're emitted
- On answer: store final result in QueryStore
- On error: store error in QueryStore

**Modified POST query endpoint**:

- Generate `queryId`, store result on completion
- Return `queryId` in response alongside AgentResponse

**Query deduplication**:

- Before starting a new run, check `QueryStore.findRunning(query, provider)`
- If found: return existing `queryId` (client polls same result)
- If not: create new entry and proceed

#### 3. SSE Event Flow (Modified)

```
Client opens SSE → Server creates queryId, stores in QueryStore
  ↓
Server emits: { type: 'init', data: { queryId } }    ← NEW
Server emits: { type: 'pipeline', data: { stage, status, ... } }
Server emits: { type: 'thought', data: { ... } }
  ... (all events also buffered into QueryStore)
Server emits: { type: 'answer', data: { ... } }
  ↓
QueryStore: status = 'complete', response = AgentResponse
```

### Frontend Changes

#### 4. RagService Simplification

**New `ConnectionState`** (3 states, down from 8):

```typescript
export type ConnectionState = 'streaming' | 'done' | 'error';
```

**Remove**:

- `backgrounded`, `reconnecting`, `stalled`, `failed` states
- Visibility handler in RagService
- Exponential backoff retry logic
- Null data counter and threshold
- `MAX_SSE_RETRIES` constant

**Keep**:

- Stall detection (but on stall → signal error, let ChatComponent fetch result)
- Event parsing (`parseStreamEvent`)
- Loading/error signals

**New method**:

```typescript
/** Fetch a stored query result by ID. */
fetchResult(queryId: string): Observable<QueryResult> {
  return this.http.get<QueryResult>(`${this.baseUrl}/query/${queryId}/result`);
}
```

**Modified `stream()` return**: Still returns `Observable<StreamEvent>`, but the first event is now `type: 'init'` with `queryId`. Add to `StreamEvent` union:

```typescript
| { type: 'init'; queryId: string }
```

#### 5. ChatComponent Changes

**New state**:

```typescript
/** The queryId for the current/last query, used for fetch-on-return. */
readonly queryId = signal<string | null>(null);
```

**Modified `submit()`**:

- On receiving `init` event: store `queryId`
- Rest unchanged

**Modified visibility handler** (simplified):

```typescript
private handleVisibilityChange(): void {
  if (document.hidden) {
    if (this.isStreaming()) this.wasBackgrounded.set(true);
    return;
  }

  // Returning to foreground
  if (!this.wasBackgrounded()) return;
  this.wasBackgrounded.set(false);

  const qid = this.queryId();
  if (!qid) return;

  // Fetch result instead of reconnecting SSE
  this.ragService.fetchResult(qid).subscribe({
    next: (result) => {
      if (result.status === 'complete' && result.response) {
        // Render the completed result
        this.response.set(result.response);
        this.pipelineEvents.set(result.pipelineEvents);
        this.steps.set(result.steps);
        this.isStreaming.set(false);
        this.loading.set(false);
        this.stopElapsedTimer();
        this.activeTab.set('answer');
      } else if (result.status === 'running') {
        // Agent still working — kill stale subscription and reconnect SSE for live updates.
        // reconnectStream() reuses handleStreamEvent() (extracted from submit()) so both
        // paths share the same event-handling logic. The backend's findRunning dedup routes
        // the reconnected SSE to pollExistingQuery, preventing a duplicate agent run.
        this.reconnectStream(qid);
      } else if (result.status === 'error') {
        this.error.set(result.error ?? 'Query failed while in background.');
        this.stopActiveStages('Error');
      }
    },
    error: () => {
      // 404 or network error — query expired or server restarted
      this.error.set('Query result expired. Tap retry to start a new query.');
      this.stopActiveStages('Expired');
    },
  });
}
```

**Simplified `connectionStatus`**:

```typescript
readonly connectionStatus = computed(() => {
  const state = this.ragService.connectionState();
  return state === 'error' ? 'Connection lost' : null;
});
```

**Remove**: All references to `reconnecting`, `backgrounded`, `stalled`, `failed` states.

### Pipeline Fallback Accuracy

`OrchestratorService.runWithFallback()` tracks completed stages via a `Set`. When the pipeline falls back to legacy mode, only stages that had not already completed are marked as error. This prevents contradictory done-then-error sequences in the pipeline event stream.

### Bug Fixes (Independent, can ship first)

#### 6. Stall Timeout Fix (AI-350)

```typescript
// Before
private static readonly STALL_TIMEOUT_MS = 200_000;

// After — 300s gives 120s buffer over 180s agent timeout
private static readonly STALL_TIMEOUT_MS = 300_000;
```

#### 7. Counter Reset Fix (AI-351)

Reset both counters on first valid event:

```typescript
// In attachListeners, after nullDataCount = 0 (line 220):
nullDataCount = 0;
retryCount = 0; // ← ADD: reset backoff on successful reconnect
```

## Code Deletion Estimate

| File                       | Lines removed                                       | Lines added                                              | Net      |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------- | -------- |
| `rag.service.ts`           | ~120 (reconnect, visibility, null counter, backoff) | ~25 (fetchResult, init event)                            | **-95**  |
| `chat.component.ts`        | ~30 (old visibility handler, connection states)     | ~35 (fetch-on-return handler)                            | **+5**   |
| `rag.controller.ts`        | ~0                                                  | ~60 (new endpoint, queryId generation, QueryStore calls) | **+60**  |
| `shared-types.ts`          | ~0                                                  | ~20 (QueryResult, PipelineEvent, init event)             | **+20**  |
| New: `query-store.ts`      | —                                                   | ~80                                                      | **+80**  |
| New: `query-store.spec.ts` | —                                                   | ~60                                                      | **+60**  |
| `rag.service.spec.ts`      | ~40 (reconnect tests)                               | ~30 (fetch-on-return tests)                              | **-10**  |
| **Total**                  | ~190                                                | ~310                                                     | **+120** |

Net: +120 lines but replaces ~150 lines of fragile state management with ~80 lines of straightforward cache operations.

**Note (post-implementation):** The estimates above are outdated. The actual implementation is leaner than projected: the inline event-handling switch in `submit()` was extracted into a shared `handleStreamEvent()` method, and the visibility handler reconnects SSE directly via `reconnectStream()` rather than relying on client-side polling, which eliminated significant duplication.

## Execution Order

```
Phase 1: Bug fixes (can ship immediately, independent)
  AI-350: Increase STALL_TIMEOUT_MS to 300s
  AI-351: Reset nullDataCount and retryCount on successful reconnect

Phase 2: Backend foundation
  AI-345: QueryStore + CacheService.set() + buffer events during stream
  AI-346: GET /api/rag/query/:id/result endpoint

Phase 3: Frontend integration
  AI-347: ChatComponent fetch-on-return + RagService.fetchResult()
  AI-348: Simplify ConnectionState to 3 states, remove reconnect logic

Phase 4: Enhancement
  AI-349: Query deduplication (findRunning check before new agent runs)
```

Phases 1 and 2 are independent. Phase 3 depends on Phase 2. Phase 4 depends on Phase 2.

## Testing Strategy

| Test                                             | Type        | Validates           |
| ------------------------------------------------ | ----------- | ------------------- |
| QueryStore.create/get/complete/fail              | Unit        | Cache lifecycle     |
| QueryStore.findRunning dedup                     | Unit        | Duplicate detection |
| GET /query/:id/result returns 200/202/404        | Integration | Endpoint contract   |
| SSE emits init event with queryId                | Integration | First event change  |
| ChatComponent renders result from fetchResult    | Component   | Fetch-on-return UX  |
| Background → foreground shows completed result   | E2E         | Full flow           |
| Background → foreground shows "still processing" | E2E         | In-progress flow    |
| Duplicate submit returns same queryId            | Integration | Dedup               |

## What This Enables (Future)

Without additional architecture changes, the QueryStore pattern naturally supports:

- **Query history**: List recent queryIds from cache
- **Shareable links**: `/q/:queryId` renders a stored result
- **TTS on stored results**: M5 voice output can work on any queryId, even if SSE is long closed
- **Offline/PWA**: Store QueryResult in IndexedDB for offline viewing
- **Analytics**: Track completion rates, timing, error rates per query

## Known Limitations

1. **In-memory cache**: Server restart loses all stored results. Acceptable for MVP. Redis upgrade would fix without API changes.
2. **5-minute TTL**: Results expire. Long enough for background-return, too short for "come back tomorrow." Increase TTL or add persistence for query history feature.
3. **No cross-device**: queryId is only known to the client that initiated it. Shareable links would fix this.
4. **Single-node only**: CacheService is per-process. Multi-node deployment would need shared cache (Redis).
