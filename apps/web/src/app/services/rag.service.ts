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
  | { type: 'error'; message: string };

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
  stream(query: string, provider?: string): Observable<StreamEvent> {
    this.loading.set(true);
    this.error.set(null);

    let url = `${this.baseUrl}/stream?query=${encodeURIComponent(query)}`;
    if (provider) {
      url += `&provider=${encodeURIComponent(provider)}`;
    }

    return new Observable<StreamEvent>((subscriber) => {
      const eventSource = new EventSource(url);

      const EVENT_TYPES = ['thought', 'action', 'observation', 'answer', 'error'] as const;

      for (const eventType of EVENT_TYPES) {
        eventSource.addEventListener(eventType, (event: MessageEvent) => {
          try {
            const data: unknown = JSON.parse(event.data);
            const streamEvent = this.parseStreamEvent(eventType, data);
            subscriber.next(streamEvent);

            if (eventType === 'answer' || eventType === 'error') {
              this.loading.set(false);
              if (eventType === 'error') {
                const msg = (streamEvent as { type: 'error'; message: string }).message;
                this.error.set(msg);
              }
              eventSource.close();
              subscriber.complete();
            }
          } catch (parseError) {
            const message =
              parseError instanceof Error ? parseError.message : 'Failed to parse SSE event';
            this.error.set(message);
            this.loading.set(false);
            subscriber.error(new Error(message));
            eventSource.close();
          }
        });
      }

      eventSource.onerror = () => {
        const message = 'SSE connection error';
        this.error.set(message);
        this.loading.set(false);
        subscriber.error(new Error(message));
        eventSource.close();
      };

      // Teardown: close EventSource when the subscriber unsubscribes.
      return () => {
        eventSource.close();
        this.loading.set(false);
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
    type: 'thought' | 'action' | 'observation' | 'answer' | 'error',
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
