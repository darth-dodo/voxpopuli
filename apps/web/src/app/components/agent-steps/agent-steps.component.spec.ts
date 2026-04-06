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

  it('should group action+observation into a single logical step', () => {
    const steps: AgentStep[] = [
      mockStep({
        type: 'action',
        toolName: 'search_hn',
        toolInput: { query: 'test' },
        timestamp: 1,
      }),
      mockStep({ type: 'observation', content: '[123] "Some Story"', timestamp: 2 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const grouped = component.groupedSteps();
    expect(grouped.length).toBe(1);
    expect(grouped[0].number).toBe(1);
    expect(grouped[0].summary).toContain('Searched HN');
    expect(grouped[0].observation).toContain('Found 1 stories');
  });

  it('should show thought steps as standalone cards', () => {
    const steps: AgentStep[] = [
      mockStep({ type: 'thought', content: 'Let me search for trends', timestamp: 1 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const grouped = component.groupedSteps();
    expect(grouped.length).toBe(1);
    expect(grouped[0].type).toBe('thought');
    expect(grouped[0].summary).toBe('Let me search for trends');
    expect(grouped[0].icon).toBe('thought');
  });

  it('should render step numbers in the template', () => {
    const steps: AgentStep[] = [
      mockStep({ type: 'thought', timestamp: 1 }),
      mockStep({
        type: 'action',
        toolName: 'search_hn',
        toolInput: { query: 'test' },
        timestamp: 2,
      }),
      mockStep({ type: 'observation', content: 'results', timestamp: 3 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    expect(el.textContent).toContain('Step 1');
    expect(el.textContent).toContain('Step 2');
  });

  it('should show human-readable summary for search_hn', () => {
    const steps: AgentStep[] = [
      mockStep({
        type: 'action',
        toolName: 'search_hn',
        toolInput: { query: 'tailwind v4' },
        timestamp: 1,
      }),
      mockStep({ type: 'observation', content: '[1] "A" [2] "B" [3] "C"', timestamp: 2 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const grouped = component.groupedSteps();
    expect(grouped[0].summary).toBe('Searched HN for "tailwind v4"');
    expect(grouped[0].observation).toBe('Found 3 stories');
  });

  it('should show human-readable summary for get_story', () => {
    const steps: AgentStep[] = [
      mockStep({ type: 'action', toolName: 'get_story', toolInput: { id: 12345 }, timestamp: 1 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const grouped = component.groupedSteps();
    expect(grouped[0].summary).toBe('Fetched story #12345');
    expect(grouped[0].icon).toBe('read');
  });

  it('should show human-readable summary for get_comments', () => {
    const steps: AgentStep[] = [
      mockStep({
        type: 'action',
        toolName: 'get_comments',
        toolInput: { storyId: 67890 },
        timestamp: 1,
      }),
      mockStep({ type: 'observation', content: '15 comments fetched', timestamp: 2 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const grouped = component.groupedSteps();
    expect(grouped[0].summary).toBe('Fetched comments for story #67890');
    expect(grouped[0].observation).toContain('15 comments');
  });

  it('should handle "No results found" observation', () => {
    const steps: AgentStep[] = [
      mockStep({
        type: 'action',
        toolName: 'search_hn',
        toolInput: { query: 'xyz' },
        timestamp: 1,
      }),
      mockStep({
        type: 'observation',
        content: 'No results found for this search query.',
        timestamp: 2,
      }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const grouped = component.groupedSteps();
    expect(grouped[0].observation).toBe('No results found');
  });

  it('should show streaming indicator when streaming', () => {
    fixture.componentRef.setInput('steps', []);
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();

    expect(el.textContent).toContain('Agent is thinking');
  });

  it('should not show streaming indicator when not streaming', () => {
    fixture.componentRef.setInput('steps', [mockStep({ type: 'thought', timestamp: 1 })]);
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();

    expect(el.textContent).not.toContain('Agent is thinking');
  });

  it('should toggle raw details for a step', () => {
    const steps: AgentStep[] = [
      mockStep({
        type: 'action',
        toolName: 'search_hn',
        toolInput: { query: 'test' },
        timestamp: 1,
      }),
      mockStep({ type: 'observation', content: 'results', timestamp: 2 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    expect(component.isRawExpanded(0)).toBe(false);

    component.toggleRaw(0);
    expect(component.isRawExpanded(0)).toBe(true);

    component.toggleRaw(0);
    expect(component.isRawExpanded(0)).toBe(false);
  });

  it('should number steps sequentially across mixed types', () => {
    const steps: AgentStep[] = [
      mockStep({ type: 'thought', timestamp: 1 }),
      mockStep({ type: 'action', toolName: 'search_hn', toolInput: { query: 'a' }, timestamp: 2 }),
      mockStep({ type: 'observation', content: '[1] "X"', timestamp: 3 }),
      mockStep({ type: 'thought', timestamp: 4 }),
      mockStep({ type: 'action', toolName: 'get_story', toolInput: { id: 1 }, timestamp: 5 }),
    ];
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();

    const grouped = component.groupedSteps();
    expect(grouped.map((g) => g.number)).toEqual([1, 2, 3, 4]);
  });
});
