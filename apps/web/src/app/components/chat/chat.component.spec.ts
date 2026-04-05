import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideMarkdown } from 'ngx-markdown';
import { of, NEVER, throwError, Subject } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    answer: '<p>Test answer about HackerNews.</p>',
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
      providers: [{ provide: RagService, useValue: ragServiceStub }, provideMarkdown()],
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
    expect(ragServiceStub.stream).toHaveBeenCalledWith('trending topics', 'groq');
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

  it('should initialize selectedProvider to groq', () => {
    expect(component.selectedProvider()).toBe('groq');
  });

  // ═══════════════════════════════════════════════════════════════════
  // NEW TESTS: Landing page rendering, goHome, enrichedAnswer, theme,
  //            stream step accumulation, partial result, steps collapse
  // ═══════════════════════════════════════════════════════════════════

  describe('Landing page (empty state)', () => {
    it('should render the hero title "VoxPopuli" in the empty state', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const h1 = compiled.querySelector('h1');
      expect(h1).toBeTruthy();
      expect(h1?.textContent).toContain('VoxPopuli');
    });

    it('should render example question buttons', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const exampleSection = compiled.querySelector('[aria-label="Example questions"]');
      expect(exampleSection).toBeTruthy();
      const buttons = exampleSection?.querySelectorAll('button');
      expect(buttons?.length).toBe(component.exampleQueries.length);
    });

    it('should render the "How it works" section', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const howItWorks = compiled.querySelector('[aria-label="How it works"]');
      expect(howItWorks).toBeTruthy();
      expect(howItWorks?.textContent).toContain('Intelligence, not search');
    });

    it('should render the example answer preview section', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const exampleResponse = compiled.querySelector('[aria-label="Example response"]');
      expect(exampleResponse).toBeTruthy();
      expect(exampleResponse?.textContent).toContain('A real answer looks like this');
    });

    it('should render the footer with version info', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const footer = compiled.querySelector('footer');
      expect(footer).toBeTruthy();
      expect(footer?.textContent).toContain('VoxPopuli v1.0');
    });

    it('should render the "Agentic RAG" category label', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const categoryLabel = compiled.querySelector('[aria-label="Product category"]');
      expect(categoryLabel).toBeTruthy();
      expect(categoryLabel?.textContent?.trim()).toBe('Agentic RAG');
    });
  });

  describe('Example question click', () => {
    it('should set the query when an example question button is clicked', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const exampleButtons = compiled.querySelectorAll('[aria-label="Example questions"] button');
      expect(exampleButtons.length).toBeGreaterThan(0);

      const firstButton = exampleButtons[0] as HTMLButtonElement;
      firstButton.click();
      fixture.detectChanges();

      expect(component.query()).toBe(component.exampleQueries[0]);
    });

    it('should set query for each example question', () => {
      for (const q of component.exampleQueries) {
        component.query.set(q);
        expect(component.query()).toBe(q);
      }
    });
  });

  describe('goHome()', () => {
    it('should reset all state to initial values', () => {
      component.query.set('some query');
      component.response.set(mockAgentResponse());
      component.error.set('some error');
      component.steps.set([{ type: 'thought', content: 'thinking', timestamp: 1000 }]);
      component.loading.set(true);
      component.isStreaming.set(true);
      component.stepsCollapsed.set(true);
      component.answerExpanded.set(true);

      component.goHome();

      expect(component.query()).toBe('');
      expect(component.response()).toBeNull();
      expect(component.error()).toBeNull();
      expect(component.steps()).toEqual([]);
      expect(component.loading()).toBe(false);
      expect(component.isStreaming()).toBe(false);
      expect(component.stepsCollapsed()).toBe(false);
      expect(component.answerExpanded()).toBe(false);
    });

    it('should return to empty state template after goHome', () => {
      // Get into active state
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      // Verify active state (no h1)
      let compiled = fixture.nativeElement as HTMLElement;
      let h1 = compiled.querySelector('h1');
      expect(h1).toBeNull();

      // Go home
      component.goHome();
      fixture.detectChanges();

      // Verify empty state restored
      compiled = fixture.nativeElement as HTMLElement;
      h1 = compiled.querySelector('h1');
      expect(h1).toBeTruthy();
      expect(h1?.textContent).toContain('VoxPopuli');
    });
  });

  describe('enrichedAnswer', () => {
    it('should return empty string when no response', () => {
      expect(component.enrichedAnswer()).toBe('');
    });

    it('should convert "Story 12345" references to HN links', () => {
      const res = mockAgentResponse({
        answer: 'Check out Story 12345 for details.',
      });
      component.response.set(res);

      const enriched = component.enrichedAnswer();
      expect(enriched).toContain('https://news.ycombinator.com/item?id=12345');
      expect(enriched).toContain('[Story 12345]');
    });

    it('should convert lowercase "story 12345" references to HN links', () => {
      const res = mockAgentResponse({
        answer: 'See story 67890 for more.',
      });
      component.response.set(res);

      const enriched = component.enrichedAnswer();
      expect(enriched).toContain('https://news.ycombinator.com/item?id=67890');
    });

    it('should convert bracket references [12345] to HN links', () => {
      const res = mockAgentResponse({
        answer: 'Reference [12345] is relevant.',
      });
      component.response.set(res);

      const enriched = component.enrichedAnswer();
      expect(enriched).toContain('https://news.ycombinator.com/item?id=12345');
    });

    it('should convert parenthetical references (12345) to HN links', () => {
      const res = mockAgentResponse({
        answer: 'See this post (12345) for context.',
      });
      component.response.set(res);

      const enriched = component.enrichedAnswer();
      expect(enriched).toContain('https://news.ycombinator.com/item?id=12345');
    });

    it('should not convert short numbers (fewer than 5 digits)', () => {
      const res = mockAgentResponse({
        answer: 'Story 123 is not a valid ID.',
      });
      component.response.set(res);

      const enriched = component.enrichedAnswer();
      expect(enriched).not.toContain('https://news.ycombinator.com/item');
    });

    it('should return answer text unchanged when no story IDs present', () => {
      const answerText = 'This answer has no story references at all.';
      const res = mockAgentResponse({ answer: answerText });
      component.response.set(res);

      expect(component.enrichedAnswer()).toBe(answerText);
    });
  });

  describe('Theme toggle', () => {
    it('should initialize with dark theme', () => {
      expect(component.theme()).toBe('dark');
    });

    it('should toggle from dark to light', () => {
      component.toggleTheme();
      expect(component.theme()).toBe('light');
    });

    it('should toggle from light back to dark', () => {
      component.toggleTheme();
      component.toggleTheme();
      expect(component.theme()).toBe('dark');
    });

    it('should update document.documentElement.className on toggle', () => {
      component.toggleTheme();
      expect(document.documentElement.className).toBe('light');
      component.toggleTheme();
      expect(document.documentElement.className).toBe('dark');
    });
  });

  describe('Stream event accumulation (via Subject)', () => {
    it('should accumulate thought, action, and observation steps incrementally', () => {
      const stream$ = new Subject<StreamEvent>();
      ragServiceStub.stream.mockReturnValue(stream$.asObservable());

      component.query.set('test');
      component.submit();

      stream$.next({ type: 'thought', content: 'Let me search...', timestamp: 1000 });
      expect(component.steps().length).toBe(1);
      expect(component.steps()[0].type).toBe('thought');
      expect(component.steps()[0].content).toBe('Let me search...');

      stream$.next({
        type: 'action',
        toolName: 'search_hn',
        toolInput: { query: 'test' },
        timestamp: 2000,
      });
      expect(component.steps().length).toBe(2);
      expect(component.steps()[1].type).toBe('action');
      expect(component.steps()[1].toolName).toBe('search_hn');

      stream$.next({ type: 'observation', content: 'Found results', timestamp: 3000 });
      expect(component.steps().length).toBe(3);
      expect(component.steps()[2].type).toBe('observation');

      expect(component.isStreaming()).toBe(true);
      expect(component.loading()).toBe(true);

      stream$.next({ type: 'answer', response: mockAgentResponse() });
      expect(component.isStreaming()).toBe(false);
      expect(component.loading()).toBe(false);
      expect(component.response()).toBeTruthy();

      stream$.complete();
    });

    it('should set isStreaming to false on observable complete', () => {
      const stream$ = new Subject<StreamEvent>();
      ragServiceStub.stream.mockReturnValue(stream$.asObservable());

      component.query.set('test');
      component.submit();
      expect(component.isStreaming()).toBe(true);

      stream$.complete();
      expect(component.isStreaming()).toBe(false);
    });
  });

  describe('Partial result detection', () => {
    it('should return false when there is no response', () => {
      expect(component.isPartialResult()).toBe(false);
    });

    it('should return true when meta.error is true', () => {
      const res = mockAgentResponse({
        meta: {
          provider: 'groq',
          totalInputTokens: 500,
          totalOutputTokens: 200,
          durationMs: 1234,
          cached: false,
          error: true,
        },
      });
      component.response.set(res);
      expect(component.isPartialResult()).toBe(true);
    });

    it('should return true when honestyFlags includes agent_error_partial_results', () => {
      const res = mockAgentResponse({
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
      component.response.set(res);
      expect(component.isPartialResult()).toBe(true);
    });

    it('should return false for a normal complete response', () => {
      component.response.set(mockAgentResponse());
      expect(component.isPartialResult()).toBe(false);
    });
  });

  describe('Steps collapse on answer', () => {
    it('should set stepsCollapsed to true when answer event arrives', () => {
      expect(component.stepsCollapsed()).toBe(false);

      component.query.set('test');
      component.submit();

      expect(component.stepsCollapsed()).toBe(true);
    });

    it('should reset stepsCollapsed to false on new submit', () => {
      component.query.set('test');
      component.submit();
      expect(component.stepsCollapsed()).toBe(true);

      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('another query');
      component.submit();
      expect(component.stepsCollapsed()).toBe(false);
    });
  });

  describe('Active state template rendering', () => {
    it('should render the active state header with goHome button when response exists', () => {
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const backButton = compiled.querySelector('[aria-label="Back to home"]');
      expect(backButton).toBeTruthy();
    });

    it('should render the agent response region', () => {
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const region = compiled.querySelector('[aria-label="Agent response"]');
      expect(region).toBeTruthy();
    });

    it('should render loading skeleton when loading with no steps', () => {
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const loadingArea = compiled.querySelector('[aria-busy="true"]');
      expect(loadingArea).toBeTruthy();
    });

    it('should render error message when error is set and not loading', () => {
      const errorStream = of<StreamEvent>({ type: 'error', message: 'Something broke' });
      ragServiceStub.stream.mockReturnValue(errorStream);

      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const alert = compiled.querySelector('[role="alert"]');
      expect(alert).toBeTruthy();
      expect(alert?.textContent).toContain('Something broke');
    });

    it('should render sources section when response has sources', () => {
      component.query.set('test');
      component.submit();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const sourcesHeading = compiled.querySelector('h3');
      expect(sourcesHeading?.textContent).toContain('Sources');
    });
  });

  describe('Submit edge cases', () => {
    it('should not submit when query exceeds max length', () => {
      const longQuery = 'a'.repeat(501);
      component.query.set(longQuery);
      expect(component.submitDisabled()).toBe(true);

      component.submit();
      expect(ragServiceStub.stream).not.toHaveBeenCalled();
    });

    it('should not submit when already loading', () => {
      component.loading.set(true);
      component.query.set('test');
      component.submit();
      expect(ragServiceStub.stream).not.toHaveBeenCalled();
    });

    it('should reset answerExpanded on new submit', () => {
      component.answerExpanded.set(true);
      ragServiceStub.stream.mockReturnValue(NEVER);
      component.query.set('test');
      component.submit();
      expect(component.answerExpanded()).toBe(false);
    });

    it('should handle non-Error thrown from stream observable', () => {
      ragServiceStub.stream.mockReturnValue(throwError(() => 'string error'));

      component.query.set('test');
      component.submit();

      expect(component.error()).toBe('Something went wrong. Please try again.');
      expect(component.loading()).toBe(false);
    });

    it('should not submit on non-Enter keydown', () => {
      component.query.set('test');
      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      component.onKeydown(event);
      expect(ragServiceStub.stream).not.toHaveBeenCalled();
    });
  });

  describe('ngOnInit', () => {
    it('should set document.documentElement.className to dark on init', () => {
      expect(document.documentElement.className).toBe('dark');
    });
  });
});
