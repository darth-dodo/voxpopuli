import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import type { AgentResponse, QueryResult } from '@voxpopuli/shared-types';
import { environment } from '../../environments/environment';

// ---------------------------------------------------------------------------
// Stream event types
// ---------------------------------------------------------------------------

/** Discriminated union of SSE events emitted by the RAG streaming endpoint. */
export type StreamEvent =
  | { type: 'thought'; content: string; timestamp: number }
  | { type: 'action'; toolName: string; toolInput: Record<string, unknown>; timestamp: number }
  | { type: 'observation'; content: string; timestamp: number }
  | { type: 'answer'; response: AgentResponse }
  | { type: 'error'; message: string }
  | { type: 'pipeline'; stage: string; status: string; detail: string; elapsed: number }
  | { type: 'token'; content: string }
  | { type: 'init'; queryId: string }
  | { type: 'ping' };

/** SSE connection lifecycle states for UI consumption. */
export type ConnectionState = 'streaming' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Angular service for communicating with the VoxPopuli RAG backend.
 *
 * Provides two query modes:
 * - `query()` -- blocking POST that returns the full agent response.
 * - `stream()` -- SSE-based streaming via native `EventSource`.
 */
@Injectable({ providedIn: 'root' })
export class RagService {
  private readonly baseUrl = `${environment.apiUrl}/rag`;

  /** Whether a request is currently in-flight. */
  readonly loading = signal(false);

  /** Human-readable error message from the most recent request, or `null`. */
  readonly error = signal<string | null>(null);

  /** Current SSE connection state for UI consumption. */
  readonly connectionState = signal<ConnectionState>('streaming');

  private readonly http = inject(HttpClient);

  // -------------------------------------------------------------------------
  // Blocking query
  // -------------------------------------------------------------------------

  /**
   * Send a blocking RAG query to the backend.
   *
   * @param query  - Natural-language question (max 500 chars).
   * @param provider - Optional LLM provider override (groq / mistral / claude).
   * @returns Observable that emits a single `AgentResponse` then completes.
   */
  query(query: string, provider?: string): Observable<AgentResponse> {
    this.loading.set(true);
    this.error.set(null);

    const body: { query: string; provider?: string } = { query };
    if (provider) {
      body.provider = provider;
    }

    return this.http
      .post<AgentResponse>(`${this.baseUrl}/query`, body)
      .pipe(catchError((err: HttpErrorResponse) => this.handleHttpError(err)));
  }

  // -------------------------------------------------------------------------
  // Fetch stored result
  // -------------------------------------------------------------------------

  /**
   * Fetch a stored query result by ID.
   * Returns the QueryResult on 200, throws on 404.
   * For 202 (still running), the response body is returned via error handling.
   */
  fetchResult(queryId: string): Observable<QueryResult> {
    return this.http.get<QueryResult>(`${this.baseUrl}/query/${queryId}/result`).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 202) {
          // Still running — return the partial data from the error response
          return new Observable<QueryResult>((sub) => {
            sub.next(err.error as QueryResult);
            sub.complete();
          });
        }
        return this.handleHttpError(err);
      }),
    );
  }

  // -------------------------------------------------------------------------
  // SSE streaming
  // -------------------------------------------------------------------------

  /**
   * Open an SSE connection to the RAG streaming endpoint.
   *
   * The returned Observable emits `StreamEvent` objects as they arrive and
   * completes when the `answer` event is received. Unsubscribing closes the
   * underlying `EventSource`.
   *
   * @param query - Natural-language question (max 500 chars).
   * @param provider - Optional LLM provider override (groq / mistral / claude).
   * @returns Observable of `StreamEvent` items.
   */

  /**
   * Stall detection threshold in milliseconds.
   * If no SSE event arrives within this window the connection is considered dead.
   * Mobile browsers often silently kill connections without firing onerror.
   */
  private static readonly STALL_TIMEOUT_MS = 300_000;

  stream(query: string, provider?: string, useMultiAgent?: boolean): Observable<StreamEvent> {
    this.loading.set(true);
    this.error.set(null);
    this.connectionState.set('streaming');

    let url = `${this.baseUrl}/stream?query=${encodeURIComponent(query)}`;
    if (provider) {
      url += `&provider=${encodeURIComponent(provider)}`;
    }
    if (useMultiAgent) {
      url += '&useMultiAgent=true';
    }

    return new Observable<StreamEvent>((subscriber) => {
      let activeEventSource: EventSource | null = null;

      /** Timestamp of the last received SSE event, used for stall detection. */
      let lastEventTime = Date.now();
      /** Handle for the stall-detection watchdog interval. */
      let stallTimer: ReturnType<typeof setInterval> | null = null;

      const clearStallTimer = (): void => {
        if (stallTimer !== null) {
          clearInterval(stallTimer);
          stallTimer = null;
        }
      };

      /** Close everything and surface a stall error to the subscriber. */
      const handleStall = (): void => {
        clearStallTimer();
        if (activeEventSource) {
          activeEventSource.close();
          activeEventSource = null;
        }
        this.connectionState.set('error');
        if (subscriber.closed) return;
        const message = 'Connection stalled — the server stopped responding.';
        this.error.set(message);
        this.loading.set(false);
        subscriber.error(new Error(message));
      };

      /** Start (or restart) the stall-detection watchdog. */
      const startStallTimer = (): void => {
        clearStallTimer();
        stallTimer = setInterval(() => {
          // Only fire if the page is visible — backgrounded tabs naturally
          // stop receiving events and should not be treated as stalls.
          if (!document.hidden && Date.now() - lastEventTime > RagService.STALL_TIMEOUT_MS) {
            handleStall();
          }
        }, 5_000);
      };

      const attachListeners = (es: EventSource): void => {
        const EVENT_TYPES = [
          'thought',
          'action',
          'observation',
          'answer',
          'error',
          'pipeline',
          'token',
          'init',
          'ping',
        ] as const;

        for (const eventType of EVENT_TYPES) {
          es.addEventListener(eventType, (event: MessageEvent) => {
            try {
              // Bump the watchdog on every received event.
              lastEventTime = Date.now();

              // Heartbeat — just reset the stall watchdog, don't forward to subscribers.
              if (eventType === 'ping') {
                return;
              }

              if (event.data === undefined || event.data === null) {
                return;
              }

              const data: unknown = JSON.parse(event.data);
              const streamEvent = this.parseStreamEvent(eventType, data);
              subscriber.next(streamEvent);

              if (eventType === 'answer' || eventType === 'error') {
                clearStallTimer();
                this.loading.set(false);
                this.connectionState.set(eventType === 'answer' ? 'done' : 'error');
                if (eventType === 'error') {
                  const msg = (streamEvent as { type: 'error'; message: string }).message;
                  this.error.set(msg);
                }
                es.close();
                activeEventSource = null;
                subscriber.complete();
              }
            } catch (parseError) {
              clearStallTimer();
              const message =
                parseError instanceof Error ? parseError.message : 'Failed to parse SSE event';
              this.error.set(message);
              this.loading.set(false);
              this.connectionState.set('error');
              subscriber.error(new Error(message));
              es.close();
              activeEventSource = null;
            }
          });
        }

        es.onerror = () => {
          es.close();
          activeEventSource = null;
          clearStallTimer();
          // If the stream already completed (answer/error received), the
          // connection close is expected — don't overwrite the terminal state.
          if (subscriber.closed) return;
          this.connectionState.set('error');
          const message = 'Connection lost — please check your network and retry.';
          this.error.set(message);
          this.loading.set(false);
          subscriber.error(new Error(message));
        };
      };

      activeEventSource = new EventSource(url);
      startStallTimer();
      attachListeners(activeEventSource);

      // Teardown: close EventSource and watchdog.
      return () => {
        clearStallTimer();
        if (activeEventSource) {
          activeEventSource.close();
          activeEventSource = null;
        }
        this.loading.set(false);
        // Only reset to 'streaming' if the connection hasn't already reached a
        // terminal state (done, error). Those states should be preserved so the
        // UI can read them after stream completion.
        const state = this.connectionState();
        if (state !== 'done' && state !== 'error') {
          this.connectionState.set('streaming');
        }
      };
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Map a raw SSE event into a typed `StreamEvent`.
   *
   * @param type - The SSE event type string.
   * @param data - The parsed JSON payload.
   * @returns A discriminated `StreamEvent`.
   */
  private parseStreamEvent(
    type: 'thought' | 'action' | 'observation' | 'answer' | 'error' | 'pipeline' | 'token' | 'init',
    data: unknown,
  ): StreamEvent {
    const record = data as Record<string, unknown>;

    switch (type) {
      case 'thought':
        return {
          type: 'thought',
          content: String(record['content'] ?? ''),
          timestamp: Number(record['timestamp'] ?? Date.now()),
        };
      case 'action':
        return {
          type: 'action',
          toolName: String(record['toolName'] ?? ''),
          toolInput: (record['toolInput'] as Record<string, unknown>) ?? {},
          timestamp: Number(record['timestamp'] ?? Date.now()),
        };
      case 'observation':
        return {
          type: 'observation',
          content: String(record['content'] ?? ''),
          timestamp: Number(record['timestamp'] ?? Date.now()),
        };
      case 'answer':
        return {
          type: 'answer',
          response: record as unknown as AgentResponse,
        };
      case 'error':
        return {
          type: 'error',
          message: String(record['message'] ?? 'Unknown error'),
        };
      case 'pipeline':
        return {
          type: 'pipeline',
          stage: String(record['stage'] ?? ''),
          status: String(record['status'] ?? ''),
          detail: String(record['detail'] ?? ''),
          elapsed: Number(record['elapsed'] ?? 0),
        };
      case 'token':
        return {
          type: 'token',
          content: String(record['content'] ?? ''),
        };
      case 'init':
        return {
          type: 'init',
          queryId: String(record['queryId'] ?? ''),
        };
    }
  }

  /**
   * Transform an `HttpErrorResponse` into a user-facing error observable
   * and update the `loading` / `error` signals.
   */
  private handleHttpError(err: HttpErrorResponse): Observable<never> {
    this.loading.set(false);

    let message: string;
    if (err.status === 400) {
      message = 'Invalid query. Please check your input and try again.';
    } else if (err.status === 429) {
      message = 'Rate limit exceeded. Please wait a moment before trying again.';
    } else if (err.status === 0) {
      message = 'Unable to reach the server. Please check your connection.';
    } else {
      message = `Server error (${err.status}). Please try again later.`;
    }

    this.error.set(message);
    return throwError(() => new Error(message));
  }
}
