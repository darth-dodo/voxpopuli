import type { AgentResponse, AgentStep, PipelineEvent } from '@voxpopuli/shared-types';
import type { EvalRunResult, LatencyTimings } from './types';

/** A parsed Server-Sent Event. */
export interface SseEvent {
  type: string;
  data: string;
}

/**
 * Split a buffered SSE byte stream into complete events.
 * Returns the parsed events and the unconsumed remainder.
 */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let type = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    events.push({ type, data: data.join('\n') });
  }
  return { events, rest };
}

/**
 * Fold a sequence of SSE events into an eval result. Pure — the clock is injected
 * so it can be unit-tested without a server.
 */
export class StreamAccumulator {
  private readonly steps: AgentStep[] = [];
  private readonly timings: LatencyTimings = { firstEventMs: -1, stages: {}, fallback: false };
  private response: AgentResponse | null = null;
  private error?: string;

  /** Record one event observed `atMs` after the request started. Returns true when the stream is finished. */
  push(event: SseEvent, atMs: number): boolean {
    if (event.type === 'ping') return false;
    if (this.timings.firstEventMs < 0) this.timings.firstEventMs = atMs;

    switch (event.type) {
      case 'pipeline': {
        const e = JSON.parse(event.data) as PipelineEvent;
        if (e.status === 'done') this.timings.stages[e.stage] = e.elapsed;
        if (e.status === 'error') this.timings.fallback = true;
        return false;
      }
      case 'thought':
      case 'action':
      case 'observation':
        this.steps.push(JSON.parse(event.data) as AgentStep);
        return false;
      case 'answer': {
        const a = JSON.parse(event.data) as Omit<AgentResponse, 'steps'>;
        this.response = { ...a, steps: this.steps };
        return true;
      }
      case 'error': {
        const parsed = JSON.parse(event.data) as { message?: string };
        this.error = parsed.message ?? event.data;
        return true;
      }
      default:
        return false;
    }
  }

  /** Build the final result once the stream ended (or was aborted). */
  result(query: string, durationMs: number): EvalRunResult {
    const error = this.error ?? (this.response ? undefined : 'Stream ended without an answer');
    return {
      queryId: '',
      query,
      response: this.response,
      durationMs,
      timings: this.timings,
      error,
    };
  }
}

/**
 * Run a query through the SSE endpoint — the path real users hit. Unlike
 * `POST /rag/query` it is not served from the 10-minute result cache, and it
 * exposes per-stage timings and whether the pipeline fell back to the legacy agent.
 */
export async function runQueryStream(
  query: string,
  provider: string,
  apiUrl: string,
  timeoutMs: number,
  useMultiAgent: boolean,
): Promise<EvalRunResult> {
  const start = performance.now();
  const acc = new StreamAccumulator();
  const params = new URLSearchParams({ query, provider, useMultiAgent: String(useMultiAgent) });

  try {
    const res = await fetch(`${apiUrl}/api/rag/stream?${params}`, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;
      for (const event of events) {
        if (acc.push(event, performance.now() - start)) {
          finished = true;
          break;
        }
      }
    }
    await reader.cancel().catch(() => undefined);
    return acc.result(query, performance.now() - start);
  } catch (err) {
    const partial = acc.result(query, performance.now() - start);
    return { ...partial, response: null, error: String(err) };
  }
}
