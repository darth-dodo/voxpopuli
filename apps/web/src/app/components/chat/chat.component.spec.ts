import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { of, NEVER, throwError } from 'rxjs';
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
      providers: [{ provide: RagService, useValue: ragServiceStub }],
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
    expect(ragServiceStub.stream).toHaveBeenCalledWith('trending topics', 'groq', true);
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
});
