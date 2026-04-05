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

  it('should show the correct badge type for each step type', () => {
    const steps: AgentStep[] = [
      mockStep({ type: 'thought', timestamp: 1 }),
      mockStep({ type: 'action', toolName: 'search_hn', timestamp: 2 }),
      mockStep({ type: 'observation', timestamp: 3 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const badges = el.querySelectorAll('.vp-badge');
    expect(badges[0].classList.contains('vp-badge--thought')).toBe(true);
    expect(badges[0].textContent?.trim()).toBe('thought');
    expect(badges[1].classList.contains('vp-badge--action')).toBe(true);
    expect(badges[1].textContent?.trim()).toBe('action');
    expect(badges[2].classList.contains('vp-badge--observation')).toBe(true);
    expect(badges[2].textContent?.trim()).toBe('observation');
  });

  it('should show the blinking cursor when streaming', () => {
    const steps: AgentStep[] = [mockStep({ type: 'thought', timestamp: 1 })];
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();

    const cursor = el.querySelector('.vp-cursor');
    expect(cursor).toBeTruthy();
  });

  it('should not show the cursor when not streaming', () => {
    const steps: AgentStep[] = [mockStep({ type: 'thought', timestamp: 1 })];
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();

    const cursor = el.querySelector('.vp-cursor');
    expect(cursor).toBeNull();
  });

  it('should show cursor with empty steps while streaming', () => {
    fixture.componentRef.setInput('steps', []);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();

    const cursor = el.querySelector('.vp-cursor');
    expect(cursor).toBeTruthy();
  });

  it('should display the step counter', () => {
    const steps: AgentStep[] = [
      mockStep({ type: 'thought', timestamp: 1 }),
      mockStep({ type: 'action', toolName: 'search_hn', timestamp: 2 }),
      mockStep({ type: 'observation', timestamp: 3 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const counter = el.textContent;
    expect(counter).toContain('Step 3 / 7');
  });

  it('should format action steps with toolName and toolInput', () => {
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

    const actionText = el.querySelector('.text-step-action')?.textContent?.trim();
    expect(actionText).toContain('search_hn');
    expect(actionText).toContain('query: "tailwind"');
    expect(actionText).toContain('max_results: 5');
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

  it('should collapse long observation content and expand on click', () => {
    const longContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const steps: AgentStep[] = [
      mockStep({ type: 'observation', content: longContent, timestamp: 1 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const contentEl = el.querySelector('.text-text-muted.whitespace-pre-line');
    expect(contentEl?.classList.contains('line-clamp-3')).toBe(true);

    // Filter out the collapse/expand header button -- get the "Show more" button
    const showMoreBtn = Array.from(el.querySelectorAll('button')).find(
      (btn) => btn.textContent?.trim() === 'Show more',
    );
    expect(showMoreBtn).toBeTruthy();

    showMoreBtn?.click();
    fixture.detectChanges();

    const updatedContent = el.querySelector('.text-text-muted.whitespace-pre-line');
    expect(updatedContent?.classList.contains('line-clamp-3')).toBe(false);
  });

  it('should not show collapse toggle for short observations', () => {
    const shortContent = 'Single line result';
    const steps: AgentStep[] = [
      mockStep({ type: 'observation', content: shortContent, timestamp: 1 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const showMoreBtn = Array.from(el.querySelectorAll('button')).find(
      (btn) => btn.textContent?.trim() === 'Show more',
    );
    expect(showMoreBtn).toBeUndefined();
  });
});
