import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import type { AgentResponse } from '@voxpopuli/shared-types';
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
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'backgrounded'
  | 'reconnecting'
  | 'stalled'
  | 'failed'
  | 'closed';

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
  readonly connectionState = signal<ConnectionState>('idle');

  private readonly http = inject(HttpClient);

  /** Visibility change handler — registered per stream, removed on teardown. */
  private visibilityHandler: (() => void) | null = null;

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
  /** Maximum number of SSE reconnection attempts before giving up. */
  private static readonly MAX_SSE_RETRIES = 2;

  /**
   * Stall detection threshold in milliseconds.
   * If no SSE event arrives within this window the connection is considered dead.
   * Mobile browsers often silently kill connections without firing onerror.
   */
  private static readonly STALL_TIMEOUT_MS = 300_000;

  stream(query: string, provider?: string, useMultiAgent?: boolean): Observable<StreamEvent> {
    this.loading.set(true);
    this.error.set(null);
    this.connectionState.set('connecting');

    let url = `${this.baseUrl}/stream?query=${encodeURIComponent(query)}`;
    if (provider) {
      url += `&provider=${encodeURIComponent(provider)}`;
    }
    if (useMultiAgent) {
      url += '&useMultiAgent=true';
    }

    return new Observable<StreamEvent>((subscriber) => {
      let retryCount = 0;
      let activeEventSource: EventSource | null = null;
      /** Tracks consecutive null-data events to avoid false positives on reconnect. */
      let nullDataCount = 0;
      const NULL_DATA_THRESHOLD = 3;

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
        this.connectionState.set('stalled');
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

              // Transition to 'open' on the first event received.
              const currentState = this.connectionState();
              if (currentState === 'connecting' || currentState === 'reconnecting') {
                this.connectionState.set('open');
              }

              // Heartbeat — just reset the stall watchdog, don't forward to subscribers.
              if (eventType === 'ping') {
                return;
              }

              if (event.data === undefined || event.data === null) {
                // After reconnect the first event may arrive with undefined data.
                // Skip it unless we see repeated null payloads, which signals a
                // real CORS / network issue.
                nullDataCount++;
                if (nullDataCount >= NULL_DATA_THRESHOLD) {
                  clearStallTimer();
                  const message =
                    'Unable to connect to the API. This may be a CORS or network issue.';
                  this.error.set(message);
                  this.loading.set(false);
                  this.connectionState.set('failed');
                  subscriber.error(new Error(message));
                  es.close();
                }
                return;
              }

              // Reset counters on any valid payload
              nullDataCount = 0;
              retryCount = 0;

              const data: unknown = JSON.parse(event.data);
              const streamEvent = this.parseStreamEvent(eventType, data);
              subscriber.next(streamEvent);

              if (eventType === 'answer' || eventType === 'error') {
                clearStallTimer();
                this.loading.set(false);
                this.connectionState.set('closed');
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
              this.connectionState.set('failed');
              subscriber.error(new Error(message));
              es.close();
              activeEventSource = null;
            }
          });
        }

        es.onerror = () => {
          if (es.readyState === EventSource.CONNECTING) {
            // Browser is auto-reconnecting — let it proceed without surfacing
            // an error to the UI. This commonly happens when a mobile browser
            // resumes after being backgrounded.
            return;
          }

          // Connection is fully closed (readyState === CLOSED).
          // Attempt a manual reconnect if we haven't exhausted retries.
          es.close();
          activeEventSource = null;

          if (retryCount < RagService.MAX_SSE_RETRIES) {
            retryCount++;
            this.connectionState.set('reconnecting');
            // Re-create the EventSource after exponential backoff with jitter.
            // Do NOT update loading/error signals — keep the streaming UI visible.
            const baseDelay = Math.min(1000 * Math.pow(2, retryCount - 1), 10_000);
            const jitter = Math.random() * 500;
            const backoffMs = baseDelay + jitter;
            setTimeout(() => {
              if (subscriber.closed) return;
              lastEventTime = Date.now(); // Reset watchdog for the new attempt.
              const newEs = new EventSource(url);
              activeEventSource = newEs;
              attachListeners(newEs);
              startStallTimer();
            }, backoffMs);
          } else {
            clearStallTimer();
            this.connectionState.set('failed');
            const message = 'Connection lost — please check your network and retry.';
            this.error.set(message);
            this.loading.set(false);
            subscriber.error(new Error(message));
          }
        };
      };

      // --- Visibility-aware connection lifecycle ---
      this.visibilityHandler = () => {
        if (document.hidden) {
          // Page backgrounded — close the connection to save resources.
          if (activeEventSource && this.connectionState() === 'open') {
            this.connectionState.set('backgrounded');
            activeEventSource.close();
            activeEventSource = null;
            clearStallTimer();
          }
        } else {
          // Page foregrounded — reconnect if we were backgrounded.
          if (this.connectionState() === 'backgrounded' && !subscriber.closed) {
            const elapsed = Date.now() - lastEventTime;
            if (elapsed > RagService.STALL_TIMEOUT_MS) {
              // Stalled while away — surface error immediately.
              this.connectionState.set('stalled');
              handleStall();
            } else {
              // Reconnect.
              this.connectionState.set('reconnecting');
              lastEventTime = Date.now();
              const newEs = new EventSource(url);
              activeEventSource = newEs;
              attachListeners(newEs);
              startStallTimer();
            }
          }
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);

      activeEventSource = new EventSource(url);
      startStallTimer();
      attachListeners(activeEventSource);

      // Teardown: close EventSource, watchdog, and visibility listener.
      return () => {
        clearStallTimer();
        if (activeEventSource) {
          activeEventSource.close();
          activeEventSource = null;
        }
        if (this.visibilityHandler) {
          document.removeEventListener('visibilitychange', this.visibilityHandler);
          this.visibilityHandler = null;
        }
        this.loading.set(false);
        // Only reset to idle if the connection hasn't already reached a
        // terminal state (closed, failed, stalled). Those states should be
        // preserved so the UI can read them after stream completion.
        const state = this.connectionState();
        if (state !== 'closed' && state !== 'failed' && state !== 'stalled') {
          this.connectionState.set('idle');
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
