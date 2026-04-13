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

  it('should initialise with connectionState=idle', () => {
    expect(service.connectionState()).toBe('idle');
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
    /** Captured visibilitychange listeners on document. */
    let visibilityListeners: Array<() => void> = [];

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

      // Capture visibilitychange event listeners
      visibilityListeners = [];
      const originalAddEventListener = document.addEventListener.bind(document);
      const originalRemoveEventListener = document.removeEventListener.bind(document);
      vi.spyOn(document, 'addEventListener').mockImplementation(
        (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'visibilitychange') {
            visibilityListeners.push(listener as () => void);
          }
          originalAddEventListener(type, listener);
        },
      );
      vi.spyOn(document, 'removeEventListener').mockImplementation(
        (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'visibilitychange') {
            visibilityListeners = visibilityListeners.filter((l) => l !== listener);
          }
          originalRemoveEventListener(type, listener);
        },
      );
    });

    afterEach(() => {
      globalThis.EventSource = originalEventSource;
      vi.restoreAllMocks();
    });

    /** Simulate a visibility change to hidden or visible. */
    function simulateVisibilityChange(hidden: boolean): void {
      documentHidden = hidden;
      for (const listener of visibilityListeners) {
        listener();
      }
    }

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

    it('should retry on connection error and fail after max retries', () => {
      vi.useFakeTimers();
      let errorThrown = false;

      service.stream('test').subscribe({
        error: () => (errorThrown = true),
      });

      // Retry 1 -- CLOSED triggers manual reconnect with exponential backoff
      mockEventSource.simulateError(MockEventSource.CLOSED);
      expect(errorThrown).toBe(false); // still retrying
      vi.advanceTimersByTime(2000); // 1s base + up to 500ms jitter

      // Retry 2
      mockEventSource.simulateError(MockEventSource.CLOSED);
      expect(errorThrown).toBe(false);
      vi.advanceTimersByTime(3000); // 2s base + up to 500ms jitter

      // Retry 3 -- exhausted (MAX_SSE_RETRIES = 2), should error
      mockEventSource.simulateError(MockEventSource.CLOSED);
      expect(errorThrown).toBe(true);
      expect(service.error()).toBe('Connection lost — please check your network and retry.');
      expect(service.loading()).toBe(false);

      vi.useRealTimers();
    });

    it('should allow browser auto-reconnect when readyState is CONNECTING', () => {
      let errorThrown = false;

      service.stream('test').subscribe({
        error: () => (errorThrown = true),
      });

      // CONNECTING state -- browser is auto-reconnecting, should not error
      mockEventSource.simulateError(MockEventSource.CONNECTING);

      expect(errorThrown).toBe(false);
      expect(service.loading()).toBe(true); // still loading
      expect(mockEventSource.closed).toBe(false); // not closed
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

    it('should skip single null data event silently', () => {
      const events: StreamEvent[] = [];
      let errorThrown = false;
      service.stream('test').subscribe({
        next: (e) => events.push(e),
        error: () => (errorThrown = true),
      });

      // Simulate an event with undefined data (MessageEvent data defaults)
      const listener = mockEventSource.listeners.get('thought');
      if (listener) {
        // Create a MessageEvent where data will be undefined
        const evt = new MessageEvent('thought', { data: undefined });
        listener(evt);
      }

      expect(events).toHaveLength(0);
      expect(errorThrown).toBe(false);
    });

    it('should error after reaching null data threshold', () => {
      let errorThrown = false;
      let errorMessage = '';
      service.stream('test').subscribe({
        error: (err: Error) => {
          errorThrown = true;
          errorMessage = err.message;
        },
      });

      const listener = mockEventSource.listeners.get('thought');
      if (listener) {
        // Send 3 null-data events (NULL_DATA_THRESHOLD = 3)
        for (let i = 0; i < 3; i++) {
          listener(new MessageEvent('thought', { data: undefined }));
        }
      }

      expect(errorThrown).toBe(true);
      expect(errorMessage).toContain('CORS');
      expect(service.loading()).toBe(false);
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
      // Before stream: idle
      expect(service.connectionState()).toBe('idle');

      const events: StreamEvent[] = [];
      let completed = false;
      const sub = service.stream('test').subscribe({
        next: (e) => events.push(e),
        complete: () => (completed = true),
      });

      // After stream() called: connecting
      expect(service.connectionState()).toBe('connecting');

      // After first event: open
      mockEventSource.simulateEvent('thought', { content: 'Thinking', timestamp: 1000 });
      expect(service.connectionState()).toBe('open');

      // After answer: closed
      mockEventSource.simulateEvent('answer', stubAgentResponse());
      expect(service.connectionState()).toBe('closed');
      expect(completed).toBe(true);

      // Terminal states are preserved after teardown (unsubscribe doesn't reset)
      sub.unsubscribe();
      expect(service.connectionState()).toBe('closed');
    });

    it('should set connectionState to reconnecting on retry', () => {
      vi.useFakeTimers();

      service.stream('test').subscribe({
        error: () => {
          /* noop */
        },
      });

      // First event to get to 'open'
      mockEventSource.simulateEvent('thought', { content: 'test', timestamp: 1 });
      expect(service.connectionState()).toBe('open');

      // Connection error -> reconnecting
      mockEventSource.simulateError(MockEventSource.CLOSED);
      expect(service.connectionState()).toBe('reconnecting');

      vi.useRealTimers();
    });

    it('should set connectionState to failed after max retries', () => {
      vi.useFakeTimers();

      service.stream('test').subscribe({
        error: () => {
          /* noop */
        },
      });

      // Exhaust retries
      mockEventSource.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(2000);
      mockEventSource.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(3000);
      mockEventSource.simulateError(MockEventSource.CLOSED);

      expect(service.connectionState()).toBe('failed');

      vi.useRealTimers();
    });

    // -------------------------------------------------------------------
    // Exponential backoff with jitter
    // -------------------------------------------------------------------

    it('should use exponential backoff with jitter on retry', () => {
      vi.useFakeTimers();
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter = 250ms

      service.stream('test').subscribe({
        error: () => {
          /* noop */
        },
      });

      // First retry: base = min(1000 * 2^0, 10000) = 1000, jitter = 250 → 1250ms
      mockEventSource.simulateError(MockEventSource.CLOSED);
      expect(service.connectionState()).toBe('reconnecting');

      // Should NOT reconnect yet at 1249ms
      vi.advanceTimersByTime(1249);
      expect(mockEventSource.closed).toBe(true); // still the old closed one

      // At 1250ms it should reconnect (new EventSource created)
      vi.advanceTimersByTime(1);
      // The new MockEventSource is assigned to mockEventSource
      expect(mockEventSource.closed).toBe(false); // new EventSource is open

      // Second retry: base = min(1000 * 2^1, 10000) = 2000, jitter = 250 → 2250ms
      mockEventSource.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(2249);
      expect(mockEventSource.closed).toBe(true); // still closed

      vi.advanceTimersByTime(1);
      expect(mockEventSource.closed).toBe(false); // reconnected

      randomSpy.mockRestore();
      vi.useRealTimers();
    });

    // -------------------------------------------------------------------
    // Stall timeout reduction
    // -------------------------------------------------------------------

    it('should use 200s stall timeout', () => {
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

      // Should NOT stall at 120s (old timeout)
      vi.advanceTimersByTime(120_000);
      expect(errorThrown).toBe(false);

      // Should stall after 200s
      vi.advanceTimersByTime(85_000); // total 205s
      expect(errorThrown).toBe(true);
      expect(errorMessage).toContain('stalled');

      vi.useRealTimers();
    });

    // -------------------------------------------------------------------
    // Visibility-aware lifecycle
    // -------------------------------------------------------------------

    it('should set backgrounded state when page is hidden during open connection', () => {
      service.stream('test').subscribe({
        error: () => {
          /* noop */
        },
      });

      // Get to open state
      mockEventSource.simulateEvent('thought', { content: 'test', timestamp: 1 });
      expect(service.connectionState()).toBe('open');

      // Background the page
      simulateVisibilityChange(true);

      expect(service.connectionState()).toBe('backgrounded');
      expect(mockEventSource.closed).toBe(true);
    });

    it('should reconnect when foregrounded after short background', () => {
      service.stream('test').subscribe({
        error: () => {
          /* noop */
        },
      });

      // Get to open state
      mockEventSource.simulateEvent('thought', { content: 'test', timestamp: 1 });
      expect(service.connectionState()).toBe('open');

      const firstEs = mockEventSource;

      // Background the page
      simulateVisibilityChange(true);
      expect(service.connectionState()).toBe('backgrounded');

      // Foreground quickly (within stall timeout)
      simulateVisibilityChange(false);
      expect(service.connectionState()).toBe('reconnecting');

      // A new EventSource should have been created
      expect(mockEventSource).not.toBe(firstEs);
      expect(mockEventSource.closed).toBe(false);
    });

    it('should handle stall on foreground after long background', () => {
      vi.useFakeTimers();
      let errorThrown = false;

      service.stream('test').subscribe({ error: () => (errorThrown = true) });

      // Get to open state
      mockEventSource.simulateEvent('thought', { content: 'test', timestamp: 1 });
      expect(service.connectionState()).toBe('open');

      // Background the page
      simulateVisibilityChange(true);
      expect(service.connectionState()).toBe('backgrounded');

      // Wait longer than stall timeout (200s)
      vi.advanceTimersByTime(205_000);

      // Foreground — should detect stall immediately
      simulateVisibilityChange(false);

      expect(service.connectionState()).toBe('stalled');
      expect(errorThrown).toBe(true);

      vi.useRealTimers();
    });

    it('should remove visibility listener on unsubscribe', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      const sub = service.stream('test').subscribe({
        error: () => {
          /* noop */
        },
      });
      sub.unsubscribe();

      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('should set connectionState to idle on unsubscribe', () => {
      const sub = service.stream('test').subscribe();
      expect(service.connectionState()).toBe('connecting');

      sub.unsubscribe();
      expect(service.connectionState()).toBe('idle');
    });
  });
});
