# ADR-005: True Mid-Loop SSE Streaming via AsyncGenerator

**Status:** Accepted
**Date:** 2026-04-05
**Deciders:** Abhishek Juneja
**Linear:** AI-180

## Context

The original `GET /api/rag/stream` endpoint was a post-completion replay: `AgentService.run()` executed the full ReAct loop, returned a complete `AgentResponse`, and the controller emitted each step as an SSE event in a burst. The user saw nothing until the agent finished — often 10–30 seconds of blank screen.

This violated M4's goal of "see the agent think in real time." The frontend's `EventSource` handling was already correct for incremental delivery, but the backend was blocking.

The agent internally already used LangChain's `agent.stream()` with `for await (const event of stream)` — the streaming primitive existed but was trapped inside a method that returned `Promise<AgentResponse>`.

## Decision

### AsyncGenerator as the streaming primitive

Add `AgentService.runStream()` as an `async *` generator that yields a discriminated union:

```typescript
type AgentStreamEvent =
  | { kind: 'step'; step: AgentStep }
  | { kind: 'complete'; response: AgentResponse };
```

The existing `for await` loop now `yield`s each step as it's produced instead of pushing to an array. The final `complete` event carries the full `AgentResponse` with trust metadata, sources, and timing.

### run() consumes runStream()

The blocking `run()` method is refactored to consume `runStream()`:

```typescript
async run(query, options): Promise<AgentResponse> {
  let lastResponse: AgentResponse | undefined;
  for await (const event of this.runStream(query, options)) {
    if (event.kind === 'complete') lastResponse = event.response;
  }
  return lastResponse;
}
```

This eliminates code duplication — semaphore, timeout, error handling, source extraction, and partial response logic exist in exactly one place.

### Controller converts generator to Observable

`RagController.stream()` wraps the generator in `new Observable()`, emitting each yielded event as an SSE `MessageEvent` immediately. Errors from the generator are caught and emitted as `error` SSE events rather than crashing the Observable.

### Alternatives considered

| Option                            | Pros                                                       | Cons                                                           |
| --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| **AsyncGenerator (chosen)**       | Native JS, zero new deps, natural fit for `for await` loop | Needs manual Observable wrapping                               |
| **RxJS Subject**                  | NestJS-native, pipes directly to `@Sse`                    | Subject lifecycle management, more boilerplate, splits logic   |
| **Callback (`onStep`)**           | Simplest change to existing code                           | Less composable, harder to test, mixes concerns                |
| **LangChain streaming callbacks** | LangChain-native approach                                  | Ties streaming to LangChain internals, harder to mock in tests |

AsyncGenerator was chosen because:

1. **The loop already exists.** The agent uses `for await (const event of stream)` — adding `yield` inside it is a one-line change per event type.
2. **Single source of truth.** `run()` wraps `runStream()`, so there's no duplication between blocking and streaming paths.
3. **Testable.** Generators are easy to mock — tests create `async function*` helpers that yield canned events. No Subject cleanup or callback wiring needed.
4. **No new dependencies.** No new packages, no RxJS Subject lifecycle management.

## Consequences

### Positive

- **Real-time UX.** Users see agent reasoning as it happens — thoughts, tool calls, and observations stream incrementally.
- **Zero duplication.** `run()` and `stream()` share the same core logic via `runStream()`.
- **No frontend changes.** The Angular `RagService.stream()` already handles SSE events incrementally via `EventSource`.
- **Partial response on failure.** Mid-loop errors still yield partial results (AI-164 behavior preserved) — the `complete` event carries the partial response.
- **Accurate stage status on fallback errors.** The pipeline fallback path in `OrchestratorService.runWithFallback()` tracks which stages completed before a downstream failure and only emits `error` events for incomplete stages. Stages that finished successfully retain their `done` status rather than being retroactively marked as `error`.

### Negative

- **Observable wrapping.** The `new Observable()` constructor in the controller is more verbose than the previous `from().pipe()` chain. This is a one-time cost.
- **Cache incompatibility.** The streaming endpoint cannot use `CacheService` since there's no complete response to cache until the generator finishes. The blocking `POST /query` endpoint still caches normally.

### Neutral

- **SSE contract unchanged.** Event types (`thought`, `action`, `observation`, `answer`, `error`) and their payloads are identical. The only difference is timing — events arrive incrementally instead of in a burst.
- **Test count increased.** Four new tests for `runStream()` (step yielding, complete response, semaphore, counter cleanup). Existing tests updated to mock `runStream` instead of `run` for the controller.
