import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AgentStep } from '@voxpopuli/shared-types';
import { AgentStepsComponent } from './agent-steps.component';

/** Helper to build a mock AgentStep. */
function mockStep(overrides: Partial<AgentStep> & Pick<AgentStep, 'type'>): AgentStep {
  return {
    content: `${overrides.type} content`,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('AgentStepsComponent', () => {
  let component: AgentStepsComponent;
  let fixture: ComponentFixture<AgentStepsComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentStepsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentStepsComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // ── Merged steps ──

  it('should merge action+observation pairs', () => {
    fixture.componentRef.setInput('steps', [
      mockStep({ type: 'action', toolName: 'search_hn', toolInput: { query: 'rust' } }),
      mockStep({
        type: 'observation',
        content: '=== STORIES === [123] "Title" by foo (99 points)',
      }),
      mockStep({ type: 'action', toolName: 'get_comments', toolInput: { story_id: 123 } }),
      mockStep({ type: 'observation', content: '=== COMMENTS === (depth 0) bar: hello' }),
    ]);
    fixture.detectChanges();

    expect(component.mergedSteps().length).toBe(2);
  });

  it('should show pending action as last in-flight step', () => {
    fixture.componentRef.setInput('steps', [
      mockStep({ type: 'action', toolName: 'search_hn', toolInput: { query: 'test' } }),
    ]);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();

    expect(component.pendingAction()).not.toBeNull();
    expect(component.mergedSteps().length).toBe(0);
  });

  it('should clear pending action once observation arrives', () => {
    fixture.componentRef.setInput('steps', [
      mockStep({ type: 'action', toolName: 'search_hn', toolInput: { query: 'test' } }),
      mockStep({ type: 'observation', content: '=== STORIES === [1] "T" by a (1 points)' }),
    ]);
    fixture.detectChanges();

    expect(component.pendingAction()).toBeNull();
    expect(component.mergedSteps().length).toBe(1);
  });

  // ── Step counter ──

  it('should count only action steps', () => {
    fixture.componentRef.setInput('steps', [
      mockStep({ type: 'action', toolName: 'search_hn', toolInput: { query: 'a' } }),
      mockStep({ type: 'observation', content: 'results' }),
      mockStep({ type: 'thought', content: 'thinking' }),
      mockStep({ type: 'action', toolName: 'search_hn', toolInput: { query: 'b' } }),
      mockStep({ type: 'observation', content: 'results' }),
    ]);
    fixture.detectChanges();

    expect(component.stepCounter()).toBe('2 steps');
  });

  // ── Format helpers ──

  it('should format search_hn action', () => {
    const step = mockStep({ type: 'action', toolName: 'search_hn', toolInput: { query: 'Rust' } });
    expect(component.formatAction(step)).toContain('Rust');
  });

  it('should format get_comments action', () => {
    const step = mockStep({
      type: 'action',
      toolName: 'get_comments',
      toolInput: { story_id: 123 },
    });
    expect(component.formatAction(step)).toContain('#123');
  });

  it('should format observation with stories', () => {
    const content = '=== STORIES === [1] "A" by x (10 points)\n[2] "B" by y (20 points)';
    expect(component.formatObservation(content)).toBe('2 stories');
  });

  it('should format observation with no results', () => {
    expect(component.formatObservation('No results found for this search query.')).toBe(
      'no results',
    );
  });

  it('should format observation with comments', () => {
    const content =
      '=== COMMENTS === (depth 0) user1: hello\n(depth 1) user2: reply\n(depth 0) user3: hi';
    expect(component.formatObservation(content)).toBe('3 comments');
  });

  // ── Streaming indicator ──

  it('should show "Researching" during streaming', () => {
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();

    expect(el.textContent).toContain('Researching');
  });

  it('should show step count when not streaming', () => {
    fixture.componentRef.setInput('steps', [
      mockStep({ type: 'action', toolName: 'search_hn', toolInput: { query: 'a' } }),
      mockStep({ type: 'observation', content: 'done' }),
    ]);
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();

    expect(el.textContent).toContain('1 step');
  });

  // ── Collapse ──

  it('should toggle collapsed state', () => {
    fixture.detectChanges();
    expect(component.collapsed()).toBe(false);
    component.toggleCollapsed();
    expect(component.collapsed()).toBe(true);
  });
});
