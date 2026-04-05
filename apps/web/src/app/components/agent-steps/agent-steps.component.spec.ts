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

  it('should render the correct number of step items', () => {
    const steps: AgentStep[] = [
      mockStep({ type: 'thought', timestamp: 1 }),
      mockStep({
        type: 'action',
        toolName: 'search_hn',
        toolInput: { query: 'test' },
        timestamp: 2,
      }),
      mockStep({ type: 'observation', timestamp: 3 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const items = el.querySelectorAll('[role="listitem"]');
    expect(items.length).toBe(3);
  });

  it('should render SVG icons for each step type', () => {
    const steps: AgentStep[] = [
      mockStep({ type: 'thought', timestamp: 1 }),
      mockStep({ type: 'action', toolName: 'search_hn', timestamp: 2 }),
      mockStep({ type: 'observation', timestamp: 3 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const items = el.querySelectorAll('[role="listitem"]');
    // Each step should have an SVG icon
    items.forEach((item) => {
      expect(item.querySelector('svg')).toBeTruthy();
    });
    // Check icon colors per step type
    expect(items[0].querySelector('.text-step-thought')).toBeTruthy();
    expect(items[1].querySelector('.text-step-action')).toBeTruthy();
    expect(items[2].querySelector('.text-step-observation')).toBeTruthy();
  });

  it('should show the streaming indicator when streaming', () => {
    const steps: AgentStep[] = [mockStep({ type: 'thought', timestamp: 1 })];
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();

    const pulse = el.querySelector('.animate-pulse');
    expect(pulse).toBeTruthy();
    expect(pulse?.textContent?.trim()).toBe('Working...');
  });

  it('should not show the streaming indicator when not streaming', () => {
    const steps: AgentStep[] = [mockStep({ type: 'thought', timestamp: 1 })];
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();

    const pulse = el.querySelector('.animate-pulse');
    expect(pulse).toBeNull();
  });

  it('should show streaming indicator with empty steps while streaming', () => {
    fixture.componentRef.setInput('steps', []);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();

    const pulse = el.querySelector('.animate-pulse');
    expect(pulse).toBeTruthy();
  });

  it('should display the step counter when not streaming', () => {
    const steps: AgentStep[] = [
      mockStep({ type: 'thought', timestamp: 1 }),
      mockStep({ type: 'action', toolName: 'search_hn', timestamp: 2 }),
      mockStep({ type: 'observation', timestamp: 3 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();

    const counter = el.textContent;
    expect(counter).toContain('Step 3 / 7');
  });

  it('should show "Thinking..." instead of step counter while streaming', () => {
    const steps: AgentStep[] = [mockStep({ type: 'thought', timestamp: 1 })];
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();

    expect(el.textContent).toContain('Thinking...');
    expect(el.textContent).not.toContain('Step 1 / 7');
  });

  it('should format action steps with human-friendly descriptions', () => {
    const steps: AgentStep[] = [
      mockStep({
        type: 'action',
        toolName: 'search_hn',
        toolInput: { query: 'tailwind', max_results: 5 },
        timestamp: 1,
      }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const actionText = el.querySelector('.text-text-primary')?.textContent?.trim();
    expect(actionText).toContain('Searching HN for');
    expect(actionText).toContain('tailwind');
  });

  it('should format get_story actions with story ID', () => {
    const steps: AgentStep[] = [
      mockStep({
        type: 'action',
        toolName: 'get_story',
        toolInput: { story_id: 12345 },
        timestamp: 1,
      }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const actionText = el.querySelector('.text-text-primary')?.textContent?.trim();
    expect(actionText).toBe('Fetching story #12345');
  });

  it('should format get_comments actions with story ID', () => {
    const steps: AgentStep[] = [
      mockStep({
        type: 'action',
        toolName: 'get_comments',
        toolInput: { story_id: 99999 },
        timestamp: 1,
      }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const actionText = el.querySelector('.text-text-primary')?.textContent?.trim();
    expect(actionText).toBe('Reading comments on story #99999');
  });

  it('should collapse and expand the entire step list', () => {
    const steps: AgentStep[] = [mockStep({ type: 'thought', timestamp: 1 })];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    expect(el.querySelector('#agent-steps-list')).toBeTruthy();

    component.toggleCollapsed();
    fixture.detectChanges();

    expect(el.querySelector('#agent-steps-list')).toBeNull();

    component.toggleCollapsed();
    fixture.detectChanges();

    expect(el.querySelector('#agent-steps-list')).toBeTruthy();
  });

  it('should show observation summaries instead of raw content', () => {
    const rawContent =
      '=== STORIES === [123] "Ask HN" by user (50 pts) [456] "Show HN" by dev (30 pts)';
    const steps: AgentStep[] = [
      mockStep({ type: 'observation', content: rawContent, timestamp: 1 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const item = el.querySelector('[role="listitem"]');
    const obsText = item?.querySelector('.text-text-muted')?.textContent?.trim();
    expect(obsText).toBe('Found 2 stories');
  });

  it('should show friendly message for no-results observations', () => {
    const steps: AgentStep[] = [
      mockStep({
        type: 'observation',
        content: 'No results found for this search query.',
        timestamp: 1,
      }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const item = el.querySelector('[role="listitem"]');
    const obsText = item?.querySelector('.text-text-muted')?.textContent?.trim();
    expect(obsText).toContain('No results');
    expect(obsText).toContain('trying a different search');
  });

  it('should allow expanding raw output for long observations', () => {
    const longContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const steps: AgentStep[] = [
      mockStep({ type: 'observation', content: longContent, timestamp: 1 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    // Should show summary, not raw content
    const summary = el.querySelector('.text-text-muted');
    expect(summary).toBeTruthy();

    // Find the "Show raw output" button
    const showRawBtn = Array.from(el.querySelectorAll('button')).find(
      (btn) => btn.textContent?.trim() === 'Show raw output',
    );
    expect(showRawBtn).toBeTruthy();

    showRawBtn?.click();
    fixture.detectChanges();

    // Raw output should now be visible in a pre element
    const preEl = el.querySelector('pre');
    expect(preEl).toBeTruthy();
    expect(preEl?.textContent).toContain(longContent);
  });

  it('should not show raw output toggle for short observations', () => {
    const shortContent = 'Single line result';
    const steps: AgentStep[] = [
      mockStep({ type: 'observation', content: shortContent, timestamp: 1 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const showRawBtn = Array.from(el.querySelectorAll('button')).find(
      (btn) => btn.textContent?.trim() === 'Show raw output',
    );
    expect(showRawBtn).toBeUndefined();
  });

  describe('formatAction', () => {
    it('should handle unknown tool names gracefully', () => {
      const step = mockStep({ type: 'action', toolName: 'unknown_tool', timestamp: 1 });
      expect(component.formatAction(step)).toBe('Running unknown_tool');
    });

    it('should handle missing tool name', () => {
      const step = mockStep({ type: 'action', timestamp: 1 });
      expect(component.formatAction(step)).toBe('Running ');
    });
  });

  describe('formatObservation', () => {
    it('should count single story correctly', () => {
      expect(component.formatObservation('[123] "Test Story"')).toBe('Found 1 story');
    });

    it('should count multiple stories correctly', () => {
      expect(component.formatObservation('[1] a [2] b [3] c')).toBe('Found 3 stories');
    });

    it('should extract comment count', () => {
      expect(component.formatObservation('=== COMMENTS === 42 total')).toBe('Found 42 comments');
    });

    it('should truncate long content without markers', () => {
      const long = 'a'.repeat(100);
      const result = component.formatObservation(long);
      expect(result.length).toBe(80);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should return short content as-is', () => {
      expect(component.formatObservation('short')).toBe('short');
    });
  });
});
