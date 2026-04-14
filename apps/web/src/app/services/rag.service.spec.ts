import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentResponse } from '@voxpopuli/shared-types';
import { RagService, StreamEvent } from './rag.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid AgentResponse for testing. */
function stubAgentResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    answer: 'Test answer',
    steps: [],
    sources: [],
    meta: {
      provider: 'groq',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      durationMs: 200,
      cached: false,
    },
    trust: {
      sourcesVerified: 1,
      sourcesTotal: 1,
      avgSourceAge: 30,
      recentSourceRatio: 1,
      viewpointDiversity: 'balanced',
      showHnCount: 0,
      honestyFlags: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RagService', () => {
  let service: RagService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(RagService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // -----------------------------------------------------------------------
  // Instantiation
  // -----------------------------------------------------------------------

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initialise with loading=false and error=null', () => {
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('should initialise with connectionState=streaming', () => {
    expect(service.connectionState()).toBe('streaming');
  });

  // -----------------------------------------------------------------------
  // query()
  // -----------------------------------------------------------------------

  describe('query()', () => {
    it('should POST to /api/rag/query and return AgentResponse', () => {
      const expected = stubAgentResponse();

      service.query('What is Hacker News?').subscribe((res) => {
        expect(res).toEqual(expected);
      });

      const req = httpMock.expectOne('/api/rag/query');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ query: 'What is Hacker News?' });
      req.flush(expected);
    });

    it('should include provider in request body when specified', () => {
      service.query('test query', 'claude').subscribe();

      const req = httpMock.expectOne('/api/rag/query');
      expect(req.request.body).toEqual({ query: 'test query', provider: 'claude' });
      req.flush(stubAgentResponse());
    });

    it('should set loading=true while request is in-flight', () => {
      service.query('test').subscribe();
      expect(service.loading()).toBe(true);

      const req = httpMock.expectOne('/api/rag/query');
      req.flush(stubAgentResponse());
    });

    it('should set error on 400 response', () => {
      service.query('').subscribe({
        error: (err: Error) => {
          expect(err.message).toContain('Invalid query');
          expect(service.error()).toContain('Invalid query');
          expect(service.loading()).toBe(false);
        },
      });

      const req = httpMock.expectOne('/api/rag/query');
      req.flush({ message: 'Bad request' }, { status: 400, statusText: 'Bad Request' });
    });

    it('should set error on 429 response', () => {
      service.query('test').subscribe({
        error: (err: Error) => {
          expect(err.message).toContain('Rate limit');
          expect(service.error()).toContain('Rate limit');
          expect(service.loading()).toBe(false);
        },
      });

      const req = httpMock.expectOne('/api/rag/query');
      req.flush({ message: 'Too many requests' }, { status: 429, statusText: 'Too Many Requests' });
    });

    it('should set error on 500 response', () => {
      service.query('test').subscribe({
        error: (err: Error) => {
          expect(err.message).toContain('Server error');
          expect(service.loading()).toBe(false);
        },
      });

      const req = httpMock.expectOne('/api/rag/query');
      req.flush(null, { status: 500, statusText: 'Internal Server Error' });
    });

    it('should set error on status 0 (network error)', () => {
      service.query('test').subscribe({
        error: (err: Error) => {
          expect(err.message).toContain('Unable to reach the server');
          expect(service.error()).toContain('Unable to reach the server');
          expect(service.loading()).toBe(false);
        },
      });

      const req = httpMock.expectOne('/api/rag/query');
      req.error(new ProgressEvent('error'), { status: 0, statusText: '' });
    });
  });

  // -----------------------------------------------------------------------
  // fetchResult()
  // -----------------------------------------------------------------------

  describe('fetchResult()', () => {
    it('should GET /api/rag/query/:id/result and return QueryResult on 200', () => {
      const mockResult = {
        queryId: 'q1',
        status: 'complete' as const,
        response: stubAgentResponse(),
        pipelineEvents: [],
        steps: [],
        error: null,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };

      service.fetchResult('q1').subscribe((res) => {
        expect(res).toEqual(mockResult);
      });

      const req = httpMock.expectOne('/api/rag/query/q1/result');
      expect(req.request.method).toBe('GET');
      req.flush(mockResult);
    });

    it('should return partial data on 202 response', () => {
      const partialResult = {
        queryId: 'q1',
        status: 'running' as const,
        response: null,
        pipelineEvents: [{ stage: 'retriever', status: 'started', detail: '', elapsed: 0 }],
        steps: [],
        error: null,
        createdAt: Date.now(),
        completedAt: null,
      };

      service.fetchResult('q1').subscribe((res) => {
        expect(res.status).toBe('running');
      });

      const req = httpMock.expectOne('/api/rag/query/q1/result');
      req.flush(partialResult, { status: 202, statusText: 'Accepted' });
    });

    it('should error on 404 response', () => {
      service.fetchResult('nonexistent').subscribe({
        error: (err: Error) => {
          expect(err.message).toContain('Server error');
        },
      });

      const req = httpMock.expectOne('/api/rag/query/nonexistent/result');
      req.flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });
    });
  });

  // -----------------------------------------------------------------------
  // stream() -- EventSource tests
  // -----------------------------------------------------------------------

  describe('stream()', () => {
    // EventSource requires a real browser; we mock it at the global level.
    let mockEventSource: MockEventSource;
    let originalEventSource: typeof EventSource;

    class MockEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;

      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;

      readonly url: string;
      readonly listeners = new Map<string, EventListener>();
      onerror: ((event: Event) => void) | null = null;
      closed = false;
      readyState = MockEventSource.OPEN;

      constructor(url: string) {
        this.url = url;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        mockEventSource = this;
      }

      addEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, listener);
      }

      close(): void {
        this.closed = true;
        this.readyState = MockEventSource.CLOSED;
      }

      /** Simulate the server sending an SSE event. */
      simulateEvent(type: string, data: unknown): void {
        const listener = this.listeners.get(type);
        if (listener) {
          listener(new MessageEvent(type, { data: JSON.stringify(data) }));
        }
      }

      /** Simulate an event with raw string data (for null/undefined testing). */
      simulateRawEvent(type: string, data: string | null | undefined): void {
        const listener = this.listeners.get(type);
        if (listener) {
          listener(new MessageEvent(type, { data: data as string }));
        }
      }

      /** Simulate a connection error with a specific readyState. */
      simulateError(readyState: number = MockEventSource.CLOSED): void {
        this.readyState = readyState;
        if (this.onerror) {
          this.onerror(new Event('error'));
        }
      }
    }

    /** Stub for document.hidden to simulate visibility changes. */
    let documentHidden = false;

    beforeEach(() => {
      originalEventSource = globalThis.EventSource;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.EventSource = MockEventSource as any;

      // Mock document.hidden
      documentHidden = false;
      Object.defineProperty(document, 'hidden', {
        get: () => documentHidden,
        configurable: true,
      });
    });

    afterEach(() => {
      globalThis.EventSource = originalEventSource;
      vi.restoreAllMocks();
    });

    it('should construct EventSource with encoded query', () => {
      service.stream('hello world').subscribe();
      expect(mockEventSource.url).toBe('/api/rag/stream?query=hello%20world');
    });

    it('should include provider parameter in URL when specified', () => {
      service.stream('test', 'mistral').subscribe();
      expect(mockEventSource.url).toBe('/api/rag/stream?query=test&provider=mistral');
    });

    it('should include useMultiAgent parameter in URL when true', () => {
      service.stream('test', undefined, true).subscribe();
      expect(mockEventSource.url).toBe('/api/rag/stream?query=test&useMultiAgent=true');
    });

    it('should include both provider and useMultiAgent in URL', () => {
      service.stream('test', 'claude', true).subscribe();
      expect(mockEventSource.url).toBe(
        '/api/rag/stream?query=test&provider=claude&useMultiAgent=true',
      );
    });

    it('should emit thought events', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('thought', { content: 'Thinking...', timestamp: 1000 });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'thought', content: 'Thinking...', timestamp: 1000 });
    });

    it('should emit action events', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('action', {
        toolName: 'search_hn',
        toolInput: { query: 'rust' },
        timestamp: 2000,
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'action',
        toolName: 'search_hn',
        toolInput: { query: 'rust' },
        timestamp: 2000,
      });
    });

    it('should emit observation events', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('observation', { content: 'Found 5 results', timestamp: 3000 });

      expect(events[0]).toEqual({
        type: 'observation',
        content: 'Found 5 results',
        timestamp: 3000,
      });
    });

    it('should emit answer event and complete the stream', () => {
      const events: StreamEvent[] = [];
      let completed = false;

      service.stream('test').subscribe({
        next: (e) => events.push(e),
        complete: () => (completed = true),
      });

      const response = stubAgentResponse();
      mockEventSource.simulateEvent('answer', response);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('answer');
      expect((events[0] as { type: 'answer'; response: AgentResponse }).response.answer).toBe(
        'Test answer',
      );
      expect(completed).toBe(true);
      expect(mockEventSource.closed).toBe(true);
      expect(service.loading()).toBe(false);
    });

    it('should emit error event, set error signal, and complete', () => {
      const events: StreamEvent[] = [];
      let completed = false;

      service.stream('test').subscribe({
        next: (e) => events.push(e),
        complete: () => (completed = true),
      });

      mockEventSource.simulateEvent('error', { message: 'Agent failed' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'error', message: 'Agent failed' });
      expect(service.error()).toBe('Agent failed');
      expect(completed).toBe(true);
      expect(mockEventSource.closed).toBe(true);
    });

    it('should error immediately on connection error with no retry', () => {
      let errorThrown = false;

      service.stream('test').subscribe({
        error: () => (errorThrown = true),
      });

      // Connection error — should error immediately, no retries
      mockEventSource.simulateError(MockEventSource.CLOSED);
      expect(errorThrown).toBe(true);
      expect(service.error()).toBe('Connection lost — please check your network and retry.');
      expect(service.loading()).toBe(false);
      expect(service.connectionState()).toBe('error');
    });

    it('should close EventSource on unsubscribe', () => {
      const sub = service.stream('test').subscribe();
      expect(mockEventSource.closed).toBe(false);

      sub.unsubscribe();
      expect(mockEventSource.closed).toBe(true);
    });

    it('should set loading=true when stream starts', () => {
      service.stream('test').subscribe();
      expect(service.loading()).toBe(true);
    });

    // -------------------------------------------------------------------
    // Pipeline event parsing
    // -------------------------------------------------------------------

    it('should emit pipeline events', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('pipeline', {
        stage: 'retriever',
        status: 'started',
        detail: '',
        elapsed: 0,
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'pipeline',
        stage: 'retriever',
        status: 'started',
        detail: '',
        elapsed: 0,
      });
    });

    it('should emit pipeline done events with detail', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('pipeline', {
        stage: 'retriever',
        status: 'done',
        detail: '3 themes from 5 sources',
        elapsed: 5000,
      });

      expect(events[0]).toEqual({
        type: 'pipeline',
        stage: 'retriever',
        status: 'done',
        detail: '3 themes from 5 sources',
        elapsed: 5000,
      });
    });

    // -------------------------------------------------------------------
    // Token event parsing
    // -------------------------------------------------------------------

    it('should emit token events', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('token', { content: 'Hello ' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'token', content: 'Hello ' });
    });

    it('should handle token event with missing content', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('token', {});

      expect(events[0]).toEqual({ type: 'token', content: '' });
    });

    // -------------------------------------------------------------------
    // Null/undefined data handling
    // -------------------------------------------------------------------

    it('should skip null data events silently', () => {
      const events: StreamEvent[] = [];
      let errorThrown = false;
      service.stream('test').subscribe({
        next: (e) => events.push(e),
        error: () => (errorThrown = true),
      });

      // Simulate events with undefined data — all should be silently skipped
      const listener = mockEventSource.listeners.get('thought');
      if (listener) {
        for (let i = 0; i < 5; i++) {
          listener(new MessageEvent('thought', { data: undefined }));
        }
      }

      expect(events).toHaveLength(0);
      expect(errorThrown).toBe(false);
    });

    // -------------------------------------------------------------------
    // parseStreamEvent — edge cases
    // -------------------------------------------------------------------

    it('should handle thought event with missing fields', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('thought', {});

      expect(events[0].type).toBe('thought');
      expect((events[0] as { type: 'thought'; content: string }).content).toBe('');
    });

    it('should handle action event with missing fields', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('action', {});

      const ev = events[0] as {
        type: 'action';
        toolName: string;
        toolInput: Record<string, unknown>;
      };
      expect(ev.type).toBe('action');
      expect(ev.toolName).toBe('');
      expect(ev.toolInput).toEqual({});
    });

    it('should handle error event with missing message', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe({
        next: (e) => events.push(e),
        complete: () => {
          /* noop */
        },
      });

      mockEventSource.simulateEvent('error', {});

      expect(events[0]).toEqual({ type: 'error', message: 'Unknown error' });
    });

    it('should handle pipeline event with missing fields', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('pipeline', {});

      expect(events[0]).toEqual({
        type: 'pipeline',
        stage: '',
        status: '',
        detail: '',
        elapsed: 0,
      });
    });

    // -------------------------------------------------------------------
    // Init event parsing
    // -------------------------------------------------------------------

    it('should emit init events with queryId', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      mockEventSource.simulateEvent('init', { queryId: 'abc-123' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'init', queryId: 'abc-123' });
    });

    // -------------------------------------------------------------------
    // Ping event handling
    // -------------------------------------------------------------------

    it('should handle ping events by resetting stall timer without emitting', () => {
      const events: StreamEvent[] = [];
      service.stream('test').subscribe((e) => events.push(e));

      // Simulate a ping event
      const listener = mockEventSource.listeners.get('ping');
      expect(listener).toBeDefined();
      if (listener) {
        listener(new MessageEvent('ping', { data: JSON.stringify({}) }));
      }

      // No events should be emitted to the subscriber
      expect(events).toHaveLength(0);
    });

    // -------------------------------------------------------------------
    // Connection state lifecycle
    // -------------------------------------------------------------------

    it('should set connectionState through lifecycle', () => {
      const events: StreamEvent[] = [];
      let completed = false;
      const sub = service.stream('test').subscribe({
        next: (e) => events.push(e),
        complete: () => (completed = true),
      });

      // After stream() called: streaming
      expect(service.connectionState()).toBe('streaming');

      // After first event: still streaming (no transition)
      mockEventSource.simulateEvent('thought', { content: 'Thinking', timestamp: 1000 });
      expect(service.connectionState()).toBe('streaming');

      // After answer: done
      mockEventSource.simulateEvent('answer', stubAgentResponse());
      expect(service.connectionState()).toBe('done');
      expect(completed).toBe(true);

      // Terminal states are preserved after teardown (unsubscribe doesn't reset)
      sub.unsubscribe();
      expect(service.connectionState()).toBe('done');
    });

    it('should set connectionState to error on connection error', () => {
      service.stream('test').subscribe({
        error: () => {
          /* noop */
        },
      });

      mockEventSource.simulateError(MockEventSource.CLOSED);
      expect(service.connectionState()).toBe('error');
    });

    it('should set connectionState to streaming on unsubscribe before terminal', () => {
      const sub = service.stream('test').subscribe();
      expect(service.connectionState()).toBe('streaming');

      sub.unsubscribe();
      // Non-terminal state resets to streaming
      expect(service.connectionState()).toBe('streaming');
    });

    // -------------------------------------------------------------------
    // Stall detection
    // -------------------------------------------------------------------

    it('should detect stall after timeout', () => {
      vi.useFakeTimers();
      let errorThrown = false;
      let errorMessage = '';

      // Ensure page is visible for stall detection
      documentHidden = false;

      service.stream('test').subscribe({
        error: (err: Error) => {
          errorThrown = true;
          errorMessage = err.message;
        },
      });

      // Should NOT stall at 120s
      vi.advanceTimersByTime(120_000);
      expect(errorThrown).toBe(false);

      // Should stall after 300s
      vi.advanceTimersByTime(185_000); // total 305s
      expect(errorThrown).toBe(true);
      expect(errorMessage).toContain('stalled');
      expect(service.connectionState()).toBe('error');

      vi.useRealTimers();
    });
  });
});
