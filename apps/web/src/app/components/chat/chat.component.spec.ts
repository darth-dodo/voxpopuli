import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { of, NEVER, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideMarkdown } from 'ngx-markdown';
import type { AgentResponse } from '@voxpopuli/shared-types';
import type { StreamEvent } from '../../services/rag.service';
import { ChatComponent } from './chat.component';
import { RagService } from '../../services/rag.service';
import { AgentStepsComponent } from '../agent-steps/agent-steps.component';
import { SourceCardComponent } from '../source-card/source-card.component';
import { TrustBarComponent } from '../trust-bar/trust-bar.component';
import { ProviderSelectorComponent } from '../provider-selector/provider-selector.component';
import { MetaBarComponent } from '../meta-bar/meta-bar.component';

/** Factory for a minimal valid AgentResponse. */
function mockAgentResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    answer: '<p>Test answer about Hacker News.</p>',
    steps: [],
    sources: [
      {
        storyId: 1,
        title: 'Test Story',
        url: 'https://example.com',
        author: 'tester',
        points: 100,
        commentCount: 10,
      },
    ],
    meta: {
      provider: 'groq',
      totalInputTokens: 500,
      totalOutputTokens: 200,
      durationMs: 1234,
      cached: false,
    },
    trust: {
      sourcesVerified: 1,
      sourcesTotal: 1,
      avgSourceAge: 5,
      recentSourceRatio: 1,
      viewpointDiversity: 'balanced',
      showHnCount: 0,
      honestyFlags: [],
    },
    ...overrides,
  };
}

/** Create a stream Observable that immediately emits an answer event. */
function mockAnswerStream(response?: AgentResponse) {
  const answerEvent: StreamEvent = {
    type: 'answer',
    response: response ?? mockAgentResponse(),
  };
  return of<StreamEvent>(answerEvent);
}

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;
  let ragServiceStub: { stream: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ragServiceStub = {
      stream: vi.fn().mockReturnValue(mockAnswerStream()),
      query: vi.fn().mockReturnValue(of(mockAgentResponse())),
    };

    await TestBed.configureTestingModule({
      imports: [
        ChatComponent,
        FormsModule,
        AgentStepsComponent,
        SourceCardComponent,
        TrustBarComponent,
        ProviderSelectorComponent,
        MetaBarComponent,
      ],
      providers: [provideMarkdown(), { provide: RagService, useValue: ragServiceStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should track character count via the charCount signal', () => {
    expect(component.charCount()).toBe(0);
    component.query.set('hello');
    expect(component.charCount()).toBe(5);
  });

  it('should update character count when query changes', () => {
    component.query.set('hello');
    expect(component.charCount()).toBe(5);
  });

  it('should disable the submit button when query is empty', () => {
    expect(component.submitDisabled()).toBe(true);
  });

  it('should enable the submit button when query has content', () => {
    component.query.set('What is trending?');
    expect(component.submitDisabled()).toBe(false);
  });

  it('should disable the submit button while loading', () => {
    component.query.set('test query');
    component.loading.set(true);
    expect(component.submitDisabled()).toBe(true);
  });

  it('should set loading to true when submitting a query', () => {
    ragServiceStub.stream.mockReturnValue(NEVER);

    component.query.set('What is trending?');
    component.submit();

    expect(component.loading()).toBe(true);
    expect(component.isStreaming()).toBe(true);
  });

  it('should render the answer on successful stream completion', () => {
    component.query.set('test');
    component.submit();

    expect(component.response()).toBeTruthy();
    expect(component.response()?.answer).toContain('Test answer');
    expect(component.loading()).toBe(false);
    expect(component.isStreaming()).toBe(false);
  });

  it('should set error on stream error event', () => {
    const errorStream = of<StreamEvent>({ type: 'error', message: 'Agent failed' });
    ragServiceStub.stream.mockReturnValue(errorStream);

    component.query.set('test');
    component.submit();

    expect(component.error()).toBe('Agent failed');
    expect(component.loading()).toBe(false);
    expect(component.isStreaming()).toBe(false);
  });

  it('should set error on observable error', () => {
    ragServiceStub.stream.mockReturnValue(throwError(() => new Error('Network failure')));

    component.query.set('test');
    component.submit();

    expect(component.error()).toBe('Network failure');
    expect(component.loading()).toBe(false);
    expect(component.isStreaming()).toBe(false);
  });

  it('should accumulate steps from stream events', () => {
    const events: StreamEvent[] = [
      { type: 'thought', content: 'Searching HN...', timestamp: 1000 },
      { type: 'action', toolName: 'search_hn', toolInput: { query: 'AI' }, timestamp: 2000 },
      { type: 'observation', content: 'Found 5 results', timestamp: 3000 },
      { type: 'answer', response: mockAgentResponse() },
    ];
    ragServiceStub.stream.mockReturnValue(of(...events));

    component.query.set('test');
    component.submit();

    expect(component.steps().length).toBe(3);
    expect(component.steps()[0].type).toBe('thought');
    expect(component.steps()[1].type).toBe('action');
    expect(component.steps()[2].type).toBe('observation');
  });

  it('should not submit when query is whitespace only', () => {
    component.query.set('   ');
    component.submit();
    expect(ragServiceStub.stream).not.toHaveBeenCalled();
  });

  it('should call ragService.stream with the trimmed query and selected provider', () => {
    component.query.set('  trending topics  ');
    component.submit();
    expect(ragServiceStub.stream).toHaveBeenCalledWith('trending topics', 'mistral', true);
  });

  it('should submit on Enter keydown', () => {
    component.query.set('test');
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    const preventSpy = vi.spyOn(event, 'preventDefault');

    component.onKeydown(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(ragServiceStub.stream).toHaveBeenCalled();
  });

  it('should clear previous response and steps on new submit', () => {
    // First submit
    component.query.set('first');
    component.submit();
    expect(component.response()).toBeTruthy();

    // Second submit
    ragServiceStub.stream.mockReturnValue(NEVER);
    component.query.set('second');
    component.submit();

    expect(component.response()).toBeNull();
    expect(component.steps()).toEqual([]);
    expect(component.error()).toBeNull();
  });

  it('should initialize selectedProvider to mistral', () => {
    expect(component.selectedProvider()).toBe('mistral');
  });

  // ---------------------------------------------------------------------------
  // toggleTheme
  // ---------------------------------------------------------------------------

  describe('toggleTheme()', () => {
    it('should switch from dark to light', () => {
      expect(component.theme()).toBe('dark');
      component.toggleTheme();
      expect(component.theme()).toBe('light');
      expect(document.documentElement.className).toBe('light');
    });

    it('should switch from light back to dark', () => {
      component.toggleTheme(); // dark -> light
      component.toggleTheme(); // light -> dark
      expect(component.theme()).toBe('dark');
      expect(document.documentElement.className).toBe('dark');
    });
  });

  // ---------------------------------------------------------------------------
  // ngOnInit / ngOnDestroy
  // ---------------------------------------------------------------------------

  describe('ngOnInit()', () => {
    it('should set dark class on document element', () => {
      expect(document.documentElement.className).toBe('dark');
    });

    it('should add visibilitychange listener', () => {
      const spy = vi.spyOn(document, 'addEventListener');
      component.ngOnInit();
      expect(spy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      spy.mockRestore();
    });
  });

  describe('ngOnDestroy()', () => {
    it('should remove visibilitychange listener', () => {
      const spy = vi.spyOn(document, 'removeEventListener');
      component.ngOnDestroy();
      expect(spy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      spy.mockRestore();
    });

    it('should stop the elapsed timer', () => {
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('test');
      component.submit();
      expect(component.elapsedSeconds()).toBe(0);
      component.ngOnDestroy();
    });
  });

  // ---------------------------------------------------------------------------
  // handleVisibilityChange
  // ---------------------------------------------------------------------------

  describe('handleVisibilityChange()', () => {
    it('should set wasBackgrounded when hidden during streaming', () => {
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('test');
      component.submit();
      expect(component.isStreaming()).toBe(true);

      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(component.wasBackgrounded()).toBe(true);
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    });

    it('should not set wasBackgrounded when hidden but not streaming', () => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(component.wasBackgrounded()).toBe(false);
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    });

    it('should show friendly message when returning from background with error', () => {
      component.query.set('test query for retry');
      component.wasBackgrounded.set(true);
      component.error.set('Connection lost');
      component.isStreaming.set(false);

      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Should show a user-friendly message but NOT auto-retry (preserves collected state)
      expect(component.error()).toBe(
        'Connection interrupted while in the background. Tap retry to try again.',
      );
      expect(component.wasBackgrounded()).toBe(false);
      expect(ragServiceStub.stream).not.toHaveBeenCalled();
    });

    it('should not retry when returning from background without error', () => {
      component.wasBackgrounded.set(true);
      component.isStreaming.set(true);
      component.error.set(null);

      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(component.wasBackgrounded()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // pipelineStatusMessage computed
  // ---------------------------------------------------------------------------

  describe('pipelineStatusMessage', () => {
    it('should return starting message when no events', () => {
      expect(component.pipelineStatusMessage()).toBe('Starting pipeline...');
    });

    it('should return retriever started message', () => {
      component.pipelineEvents.set([
        { stage: 'retriever', status: 'started', detail: '', elapsed: 0 },
      ]);
      expect(component.pipelineStatusMessage()).toBe('Searching HN and collecting evidence...');
    });

    it('should return retriever done message', () => {
      component.pipelineEvents.set([
        { stage: 'retriever', status: 'done', detail: '', elapsed: 5000 },
      ]);
      expect(component.pipelineStatusMessage()).toBe('Evidence collected. Analyzing...');
    });

    it('should return synthesizer started message', () => {
      component.pipelineEvents.set([
        { stage: 'retriever', status: 'done', detail: '', elapsed: 5000 },
        { stage: 'synthesizer', status: 'started', detail: '', elapsed: 0 },
      ]);
      expect(component.pipelineStatusMessage()).toBe('Analyzing themes and extracting insights...');
    });

    it('should return synthesizer done message', () => {
      component.pipelineEvents.set([
        { stage: 'synthesizer', status: 'done', detail: '', elapsed: 3000 },
      ]);
      expect(component.pipelineStatusMessage()).toBe('Analysis complete. Writing response...');
    });

    it('should return writer started message', () => {
      component.pipelineEvents.set([
        { stage: 'writer', status: 'started', detail: '', elapsed: 0 },
      ]);
      expect(component.pipelineStatusMessage()).toBe('Composing your answer...');
    });

    it('should return writer done message', () => {
      component.pipelineEvents.set([
        { stage: 'writer', status: 'done', detail: '', elapsed: 2000 },
      ]);
      expect(component.pipelineStatusMessage()).toBe('Response ready.');
    });

    it('should return Processing for unknown stage', () => {
      component.pipelineEvents.set([
        { stage: 'unknown_stage', status: 'started', detail: '', elapsed: 0 },
      ]);
      expect(component.pipelineStatusMessage()).toBe('Processing...');
    });
  });

  // ---------------------------------------------------------------------------
  // enrichedAnswer computed
  // ---------------------------------------------------------------------------

  describe('enrichedAnswer', () => {
    it('should return empty string when no response', () => {
      component.response.set(null);
      expect(component.enrichedAnswer()).toBe('');
    });

    it('should convert "Story 12345" to HN link', () => {
      component.response.set(mockAgentResponse({ answer: 'See Story 12345 for details.' }));
      expect(component.enrichedAnswer()).toContain('https://news.ycombinator.com/item?id=12345');
    });

    it('should convert "[12345]" to HN link', () => {
      component.response.set(mockAgentResponse({ answer: 'Reference [12345] is relevant.' }));
      expect(component.enrichedAnswer()).toContain('https://news.ycombinator.com/item?id=12345');
    });

    it('should convert "(12345)" to HN link', () => {
      component.response.set(mockAgentResponse({ answer: 'Source (12345) supports this.' }));
      expect(component.enrichedAnswer()).toContain('https://news.ycombinator.com/item?id=12345');
    });

    it('should not convert short numbers', () => {
      component.response.set(mockAgentResponse({ answer: 'Only 123 results.' }));
      expect(component.enrichedAnswer()).not.toContain('news.ycombinator.com');
    });

    it('should handle multiple story references', () => {
      component.response.set(
        mockAgentResponse({ answer: 'Story 11111 and Story 22222 are related.' }),
      );
      const enriched = component.enrichedAnswer();
      expect(enriched).toContain('item?id=11111');
      expect(enriched).toContain('item?id=22222');
    });
  });

  // ---------------------------------------------------------------------------
  // collectedContext computed
  // ---------------------------------------------------------------------------

  describe('collectedContext', () => {
    it('should return null when no steps', () => {
      component.steps.set([]);
      expect(component.collectedContext()).toBeNull();
    });

    it('should return null when observations have no results', () => {
      component.steps.set([{ type: 'observation', content: 'No results found', timestamp: 1 }]);
      expect(component.collectedContext()).toBeNull();
    });

    it('should extract story titles from observations', () => {
      component.steps.set([
        {
          type: 'observation',
          content: '[123] "First Story Title"\n[456] "Second Story Title"',
          timestamp: 1,
        },
      ]);
      const ctx = component.collectedContext();
      expect(ctx).not.toBeNull();
      expect(ctx!.storyCount).toBe(2);
      expect(ctx!.titles).toContain('First Story Title');
      expect(ctx!.titles).toContain('Second Story Title');
    });

    it('should deduplicate titles', () => {
      component.steps.set([
        {
          type: 'observation',
          content: '[1] "Duplicate Title"',
          timestamp: 1,
        },
        {
          type: 'observation',
          content: '[2] "Duplicate Title"',
          timestamp: 2,
        },
      ]);
      const ctx = component.collectedContext();
      expect(ctx).not.toBeNull();
      expect(ctx!.titles.filter((t) => t === 'Duplicate Title').length).toBe(1);
    });

    it('should limit titles to 5', () => {
      const lines = Array.from({ length: 8 }, (_, i) => `[${i}] "Story ${i}"`).join('\n');
      component.steps.set([{ type: 'observation', content: lines, timestamp: 1 }]);
      const ctx = component.collectedContext();
      expect(ctx!.titles.length).toBe(5);
    });

    it('should include step count', () => {
      component.steps.set([
        { type: 'thought', content: 'thinking', timestamp: 1 },
        {
          type: 'observation',
          content: '[1] "Some Story"',
          timestamp: 2,
        },
      ]);
      const ctx = component.collectedContext();
      expect(ctx!.stepCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // copyAnswer
  // ---------------------------------------------------------------------------

  describe('copyAnswer()', () => {
    it('should copy answer text to clipboard and set copied signal', async () => {
      vi.useFakeTimers();
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

      component.response.set(mockAgentResponse({ answer: 'Copy me' }));
      component.copyAnswer();

      await vi.advanceTimersByTimeAsync(0);

      expect(writeTextMock).toHaveBeenCalledWith('Copy me');
      expect(component.copied()).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(component.copied()).toBe(false);

      vi.useRealTimers();
    });

    it('should do nothing when response is null', () => {
      component.response.set(null);
      const writeTextMock = vi.fn();
      Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

      component.copyAnswer();
      expect(writeTextMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // goHome
  // ---------------------------------------------------------------------------

  describe('goHome()', () => {
    it('should reset all signals to initial state', () => {
      component.query.set('some query');
      component.response.set(mockAgentResponse());
      component.error.set('some error');
      component.steps.set([{ type: 'thought', content: 'test', timestamp: 1 }]);
      component.pipelineEvents.set([
        { stage: 'retriever', status: 'done', detail: '', elapsed: 1000 },
      ]);
      component.isPipelineMode.set(true);
      component.tokenContent.set('some content');
      component.loading.set(true);
      component.isStreaming.set(true);

      component.goHome();

      expect(component.query()).toBe('');
      expect(component.response()).toBeNull();
      expect(component.error()).toBeNull();
      expect(component.steps()).toEqual([]);
      expect(component.pipelineEvents()).toEqual([]);
      expect(component.isPipelineMode()).toBe(false);
      expect(component.tokenContent()).toBe('');
      expect(component.loading()).toBe(false);
      expect(component.isStreaming()).toBe(false);
      expect(component.activeTab()).toBe('steps');
    });
  });

  // ---------------------------------------------------------------------------
  // activeTab
  // ---------------------------------------------------------------------------

  describe('activeTab', () => {
    it('should default to steps', () => {
      expect(component.activeTab()).toBe('steps');
    });

    it('should be set to steps on submit', () => {
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.activeTab.set('answer');
      component.query.set('test');
      component.submit();
      expect(component.activeTab()).toBe('steps');
    });

    it('should switch to answer when answer event arrives', () => {
      component.query.set('test');
      component.submit();
      expect(component.activeTab()).toBe('answer');
    });

    it('should switch to answer on error event', () => {
      ragServiceStub.stream.mockReturnValue(of<StreamEvent>({ type: 'error', message: 'fail' }));
      component.query.set('test');
      component.submit();
      expect(component.activeTab()).toBe('answer');
    });

    it('should switch to answer on observable error', () => {
      ragServiceStub.stream.mockReturnValue(throwError(() => new Error('boom')));
      component.query.set('test');
      component.submit();
      expect(component.activeTab()).toBe('answer');
    });
  });

  // ---------------------------------------------------------------------------
  // Pipeline events handling in submit()
  // ---------------------------------------------------------------------------

  describe('pipeline events in submit()', () => {
    it('should set isPipelineMode on pipeline event', () => {
      const events: StreamEvent[] = [
        {
          type: 'pipeline',
          stage: 'retriever',
          status: 'started',
          detail: '',
          elapsed: 0,
        },
        { type: 'answer', response: mockAgentResponse() },
      ];
      ragServiceStub.stream.mockReturnValue(of(...events));

      component.query.set('test');
      component.submit();

      expect(component.isPipelineMode()).toBe(true);
      expect(component.pipelineEvents().length).toBe(1);
      expect(component.pipelineEvents()[0].stage).toBe('retriever');
    });

    it('should accumulate multiple pipeline events', () => {
      const events: StreamEvent[] = [
        { type: 'pipeline', stage: 'retriever', status: 'started', detail: '', elapsed: 0 },
        {
          type: 'pipeline',
          stage: 'retriever',
          status: 'done',
          detail: '3 themes from 5 sources',
          elapsed: 5000,
        },
        { type: 'pipeline', stage: 'synthesizer', status: 'started', detail: '', elapsed: 0 },
        { type: 'answer', response: mockAgentResponse() },
      ];
      ragServiceStub.stream.mockReturnValue(of(...events));

      component.query.set('test');
      component.submit();

      expect(component.pipelineEvents().length).toBe(3);
    });

    it('should accumulate token content on token events', () => {
      const events: StreamEvent[] = [
        { type: 'token', content: 'Hello ' },
        { type: 'token', content: 'world' },
        { type: 'answer', response: mockAgentResponse() },
      ];
      ragServiceStub.stream.mockReturnValue(of(...events));

      component.query.set('test');
      component.submit();

      expect(component.tokenContent()).toBe('Hello world');
    });
  });

  // ---------------------------------------------------------------------------
  // submit() -- query length validation
  // ---------------------------------------------------------------------------

  describe('submit() query length validation', () => {
    it('should not submit when query exceeds MAX_QUERY_LENGTH', () => {
      const longQuery = 'a'.repeat(501);
      component.query.set(longQuery);
      component.submit();
      expect(ragServiceStub.stream).not.toHaveBeenCalled();
    });

    it('should disable submit button when query exceeds MAX_QUERY_LENGTH', () => {
      component.query.set('a'.repeat(501));
      expect(component.submitDisabled()).toBe(true);
    });

    it('should allow query at exactly MAX_QUERY_LENGTH', () => {
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('a'.repeat(500));
      expect(component.submitDisabled()).toBe(false);
      component.submit();
      expect(ragServiceStub.stream).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // submit() clears pipeline state on new submit
  // ---------------------------------------------------------------------------

  describe('submit() pipeline state reset', () => {
    it('should clear pipeline events and mode on new submit', () => {
      const pipelineEvents: StreamEvent[] = [
        { type: 'pipeline', stage: 'retriever', status: 'done', detail: '', elapsed: 5000 },
        { type: 'answer', response: mockAgentResponse() },
      ];
      ragServiceStub.stream.mockReturnValue(of(...pipelineEvents));
      component.query.set('first');
      component.submit();
      expect(component.isPipelineMode()).toBe(true);
      expect(component.pipelineEvents().length).toBe(1);

      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('second');
      component.submit();
      expect(component.isPipelineMode()).toBe(false);
      expect(component.pipelineEvents()).toEqual([]);
      expect(component.tokenContent()).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // elapsedSeconds timer
  // ---------------------------------------------------------------------------

  describe('elapsedSeconds timer', () => {
    it('should start at 0 and increment during streaming', () => {
      vi.useFakeTimers();
      ragServiceStub.stream.mockReturnValue(NEVER);

      component.query.set('test');
      component.submit();
      expect(component.elapsedSeconds()).toBe(0);

      vi.advanceTimersByTime(3000);
      expect(component.elapsedSeconds()).toBe(3);

      vi.useRealTimers();
    });

    it('should stop on answer', () => {
      vi.useFakeTimers();
      ragServiceStub.stream.mockReturnValue(mockAnswerStream());

      component.query.set('test');
      component.submit();

      const elapsed = component.elapsedSeconds();
      vi.advanceTimersByTime(5000);
      expect(component.elapsedSeconds()).toBe(elapsed);

      vi.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // Template rendering tests -- exercise HTML branches
  // ---------------------------------------------------------------------------

  describe('template rendering', () => {
    it('should show landing page when no loading, error, or response', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('VoxPopuli');
      expect(el.textContent).toContain('Agentic RAG');
      expect(el.textContent).toContain('How it works');
    });

    it('should show example queries on landing page', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('What are the top trends on HN this week?');
    });

    it('should show active state with tabs when response is present', () => {
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Answer');
      expect(el.textContent).toContain('Sources');
      expect(el.textContent).toContain('Steps');
      expect(el.textContent).toContain('New question');
    });

    it('should show loading skeleton when loading without pipeline mode', () => {
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('test');
      component.submit();
      component.activeTab.set('answer');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Searching Hacker News...');
    });

    it('should show error state in template', () => {
      ragServiceStub.stream.mockReturnValue(
        of<StreamEvent>({ type: 'error', message: 'Agent failed' }),
      );
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Agent failed');
      expect(el.textContent).toContain('Retry query');
    });

    it('should show timeout error message for SSE errors', () => {
      ragServiceStub.stream.mockReturnValue(
        of<StreamEvent>({ type: 'error', message: 'SSE connection lost' }),
      );
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Agent timed out');
    });

    it('should show collected context when steps exist with error', () => {
      const events: StreamEvent[] = [
        { type: 'thought', content: 'thinking', timestamp: 1 },
        { type: 'observation', content: '[1] "Cool Story"', timestamp: 2 },
        { type: 'error', message: 'timeout' },
      ];
      ragServiceStub.stream.mockReturnValue(of(...events));

      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Collected before timeout');
      expect(el.textContent).toContain('Cool Story');
    });

    it('should show answer content when response is present', () => {
      component.query.set('test');
      component.submit();
      component.activeTab.set('answer');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Copy');
    });

    it('should show sources tab content', () => {
      component.query.set('test');
      component.submit();
      component.activeTab.set('sources');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('1 sources');
    });

    it('should show empty sources message when response has no sources', () => {
      ragServiceStub.stream.mockReturnValue(mockAnswerStream(mockAgentResponse({ sources: [] })));
      component.query.set('test');
      component.submit();
      component.activeTab.set('sources');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('No sources available');
    });

    it('should show sources placeholder when no response yet', () => {
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('test');
      component.submit();
      component.activeTab.set('sources');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Sources will appear after the agent completes');
    });

    it('should show steps tab placeholder when no steps', () => {
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('test');
      component.submit();
      component.isStreaming.set(false);
      component.activeTab.set('steps');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Agent steps will appear here during processing');
    });

    it('should show pipeline status when in pipeline mode and streaming', () => {
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('test');
      component.submit();
      component.isPipelineMode.set(true);
      component.pipelineEvents.set([
        { stage: 'retriever', status: 'started', detail: '', elapsed: 0 },
      ]);
      component.activeTab.set('answer');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Searching HN and collecting evidence...');
    });

    it('should show partial result warning for error responses', () => {
      const resp = mockAgentResponse({
        meta: {
          provider: 'groq',
          totalInputTokens: 500,
          totalOutputTokens: 200,
          durationMs: 1234,
          cached: false,
          error: true,
        },
        trust: {
          sourcesVerified: 1,
          sourcesTotal: 1,
          avgSourceAge: 5,
          recentSourceRatio: 1,
          viewpointDiversity: 'balanced',
          showHnCount: 0,
          honestyFlags: ['agent_error_partial_results'],
        },
      });
      ragServiceStub.stream.mockReturnValue(mockAnswerStream(resp));
      component.query.set('test');
      component.submit();
      component.activeTab.set('answer');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Partial results');
    });

    it('should render theme toggle with correct aria-label', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const btn = el.querySelector('[aria-label="Switch to light theme"]');
      expect(btn).toBeTruthy();
    });

    it('should switch theme toggle aria-label after toggle', () => {
      component.toggleTheme();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const btn = el.querySelector('[aria-label="Switch to dark theme"]');
      expect(btn).toBeTruthy();
    });

    it('should show source count on Sources tab when response present', () => {
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Sources (1)');
    });

    it('should show step count on Steps tab when steps present', () => {
      const events: StreamEvent[] = [
        { type: 'thought', content: 'thinking', timestamp: 1 },
        { type: 'answer', response: mockAgentResponse() },
      ];
      ragServiceStub.stream.mockReturnValue(of(...events));
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Steps (1)');
    });
  });
});
