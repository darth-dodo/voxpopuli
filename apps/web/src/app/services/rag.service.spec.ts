import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
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
  });

  // -----------------------------------------------------------------------
  // stream() -- EventSource tests
  // -----------------------------------------------------------------------

  describe('stream()', () => {
    // EventSource requires a real browser; we mock it at the global level.
    let mockEventSource: MockEventSource;
    let originalEventSource: typeof EventSource;

    class MockEventSource {
      readonly url: string;
      readonly listeners = new Map<string, EventListener>();
      onerror: ((event: Event) => void) | null = null;
      closed = false;

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
      }

      /** Simulate the server sending an SSE event. */
      simulateEvent(type: string, data: unknown): void {
        const listener = this.listeners.get(type);
        if (listener) {
          listener(new MessageEvent(type, { data: JSON.stringify(data) }));
        }
      }

      /** Simulate a connection error. */
      simulateError(): void {
        if (this.onerror) {
          this.onerror(new Event('error'));
        }
      }
    }

    beforeEach(() => {
      originalEventSource = globalThis.EventSource;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.EventSource = MockEventSource as any;
    });

    afterEach(() => {
      globalThis.EventSource = originalEventSource;
    });

    it('should construct EventSource with encoded query', () => {
      service.stream('hello world').subscribe();
      expect(mockEventSource.url).toBe('/api/rag/stream?query=hello%20world');
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

    it('should handle connection errors', () => {
      let errorThrown = false;

      service.stream('test').subscribe({
        error: () => (errorThrown = true),
      });

      mockEventSource.simulateError();

      expect(errorThrown).toBe(true);
      expect(service.error()).toBe('SSE connection error');
      expect(service.loading()).toBe(false);
      expect(mockEventSource.closed).toBe(true);
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
  });
});
