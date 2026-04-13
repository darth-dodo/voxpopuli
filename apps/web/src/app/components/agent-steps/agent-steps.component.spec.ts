import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
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

  // ---------------------------------------------------------------------------
  // Pipeline mode - pipelineStages computed
  // ---------------------------------------------------------------------------

  describe('pipelineStages', () => {
    it('should return empty array when no pipeline events', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', []);
      fixture.detectChanges();

      expect(component.pipelineStages()).toEqual([]);
    });

    it('should group events by stage in retriever -> synthesizer -> writer order', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'writer', status: 'started', detail: '', elapsed: 0 },
        { stage: 'retriever', status: 'done', detail: '3 themes', elapsed: 5000 },
        { stage: 'synthesizer', status: 'done', detail: '4 insights', elapsed: 3000 },
      ]);
      fixture.detectChanges();

      const stages = component.pipelineStages();
      expect(stages.length).toBe(3);
      expect(stages[0].name).toBe('retriever');
      expect(stages[1].name).toBe('synthesizer');
      expect(stages[2].name).toBe('writer');
    });

    it('should use latest event per stage', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'started', detail: '', elapsed: 0 },
        { stage: 'retriever', status: 'done', detail: '3 themes from 5 sources', elapsed: 5000 },
      ]);
      fixture.detectChanges();

      const stages = component.pipelineStages();
      expect(stages.length).toBe(1);
      expect(stages[0].status).toBe('done');
      expect(stages[0].elapsed).toBe(5000);
    });

    it('should omit stages not in the known set', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'unknown_stage', status: 'done', detail: '', elapsed: 100 },
        { stage: 'retriever', status: 'done', detail: '', elapsed: 5000 },
      ]);
      fixture.detectChanges();

      const stages = component.pipelineStages();
      expect(stages.length).toBe(1);
      expect(stages[0].name).toBe('retriever');
    });
  });

  // ---------------------------------------------------------------------------
  // totalPipelineTime computed
  // ---------------------------------------------------------------------------

  describe('totalPipelineTime', () => {
    it('should return 0 when no stages', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', []);
      fixture.detectChanges();
      expect(component.totalPipelineTime()).toBe(0);
    });

    it('should sum elapsed times across stages', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'done', detail: '', elapsed: 5000 },
        { stage: 'synthesizer', status: 'done', detail: '', elapsed: 3000 },
        { stage: 'writer', status: 'done', detail: '', elapsed: 2000 },
      ]);
      fixture.detectChanges();
      expect(component.totalPipelineTime()).toBe(10000);
    });
  });

  // ---------------------------------------------------------------------------
  // stageElapsed method
  // ---------------------------------------------------------------------------

  describe('stageElapsed()', () => {
    it('should return elapsed for done stages', () => {
      const stage = { name: 'retriever', status: 'done', elapsed: 5000 };
      expect(component.stageElapsed(stage)).toBe(5000);
    });

    it('should return elapsed for error stages', () => {
      const stage = { name: 'retriever', status: 'error', elapsed: 2000 };
      expect(component.stageElapsed(stage)).toBe(2000);
    });

    it('should return liveElapsed for active stages', () => {
      component.liveElapsed.set(new Map([['retriever', 1500]]));
      const stage = { name: 'retriever', status: 'started', elapsed: 0 };
      expect(component.stageElapsed(stage)).toBe(1500);
    });

    it('should return 0 for active stage with no liveElapsed entry', () => {
      component.liveElapsed.set(new Map());
      const stage = { name: 'retriever', status: 'started', elapsed: 0 };
      expect(component.stageElapsed(stage)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // parsedStageDetails computed
  // ---------------------------------------------------------------------------

  describe('parsedStageDetails', () => {
    it('should parse retriever details with themes, sources, and tokens', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        {
          stage: 'retriever',
          status: 'done',
          detail: '3 themes from 5 sources, ~12000 tokens',
          elapsed: 5000,
        },
      ]);
      fixture.detectChanges();

      const parsed = component.parsedStageDetails();
      const chips = parsed.get('retriever');
      expect(chips).toBeDefined();
      expect(chips!.length).toBe(3);
      expect(chips!.find((c) => c.label === 'themes')?.value).toBe('3');
      expect(chips!.find((c) => c.label === 'sources')?.value).toBe('5');
      expect(chips!.find((c) => c.label === 'tokens')?.value).toBe('~12000');
    });

    it('should parse synthesizer details with insights, contradictions, and confidence', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        {
          stage: 'synthesizer',
          status: 'done',
          detail: '4 insights, 2 contradictions, confidence: high',
          elapsed: 3000,
        },
      ]);
      fixture.detectChanges();

      const parsed = component.parsedStageDetails();
      const chips = parsed.get('synthesizer');
      expect(chips).toBeDefined();
      expect(chips!.find((c) => c.label === 'insights')?.value).toBe('4');
      expect(chips!.find((c) => c.label === 'contradictions')?.value).toBe('2');
      expect(chips!.find((c) => c.label === 'confidence')?.value).toBe('high');
      expect(chips!.find((c) => c.label === 'confidence')?.color).toBe('text-trust-verified');
    });

    it('should use amber color for medium confidence', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        {
          stage: 'synthesizer',
          status: 'done',
          detail: '2 insights, 0 contradictions, confidence: medium',
          elapsed: 3000,
        },
      ]);
      fixture.detectChanges();

      const chips = component.parsedStageDetails().get('synthesizer');
      expect(chips!.find((c) => c.label === 'confidence')?.color).toBe('text-accent-amber');
    });

    it('should use danger color for low confidence', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        {
          stage: 'synthesizer',
          status: 'done',
          detail: '1 insight, 0 contradictions, confidence: low',
          elapsed: 2000,
        },
      ]);
      fixture.detectChanges();

      const chips = component.parsedStageDetails().get('synthesizer');
      expect(chips!.find((c) => c.label === 'confidence')?.color).toBe('text-trust-danger');
    });

    it('should not include contradictions chip when count is 0', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        {
          stage: 'synthesizer',
          status: 'done',
          detail: '3 insights, 0 contradictions, confidence: high',
          elapsed: 3000,
        },
      ]);
      fixture.detectChanges();

      const chips = component.parsedStageDetails().get('synthesizer');
      expect(chips!.find((c) => c.label === 'contradictions')).toBeUndefined();
    });

    it('should parse writer details with sections and cited sources', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        {
          stage: 'writer',
          status: 'done',
          detail: '4 sections, 6 sources cited',
          elapsed: 2000,
        },
      ]);
      fixture.detectChanges();

      const parsed = component.parsedStageDetails();
      const chips = parsed.get('writer');
      expect(chips).toBeDefined();
      expect(chips!.find((c) => c.label === 'sections')?.value).toBe('4');
      expect(chips!.find((c) => c.label === 'cited')?.value).toBe('6');
    });

    it('should skip stages that are not done', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'started', detail: '', elapsed: 0 },
      ]);
      fixture.detectChanges();

      const parsed = component.parsedStageDetails();
      expect(parsed.get('retriever')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // innerStepsCollapsed signal
  // ---------------------------------------------------------------------------

  describe('innerStepsCollapsed', () => {
    it('should default to true', () => {
      expect(component.innerStepsCollapsed()).toBe(true);
    });

    it('should toggle', () => {
      component.innerStepsCollapsed.set(false);
      expect(component.innerStepsCollapsed()).toBe(false);
      component.innerStepsCollapsed.set(true);
      expect(component.innerStepsCollapsed()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Standalone observation steps
  // ---------------------------------------------------------------------------

  describe('standalone observation steps', () => {
    it('should render observation without preceding action as standalone', () => {
      const steps: AgentStep[] = [
        mockStep({ type: 'observation', content: '[1] "Standalone Story"', timestamp: 1 }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      const grouped = component.groupedSteps();
      expect(grouped.length).toBe(1);
      expect(grouped[0].type).toBe('observation');
      expect(grouped[0].summary).toBe('Found 1 stories');
      expect(grouped[0].icon).toBe('search');
      expect(grouped[0].rawObservation).toContain('Standalone Story');
    });
  });

  // ---------------------------------------------------------------------------
  // formatRawAction edge cases
  // ---------------------------------------------------------------------------

  describe('formatRawAction', () => {
    it('should return content when step has no toolName', () => {
      const steps: AgentStep[] = [
        mockStep({ type: 'action', content: 'raw action text', timestamp: 1 }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      const grouped = component.groupedSteps();
      expect(grouped[0].rawAction).toBe('raw action text');
    });

    it('should format tool call with arguments', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'search_hn',
          toolInput: { query: 'rust', limit: 10 },
          timestamp: 1,
        }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      const grouped = component.groupedSteps();
      expect(grouped[0].rawAction).toBe('search_hn(query: "rust", limit: 10)');
    });

    it('should format tool call with no arguments', () => {
      const steps: AgentStep[] = [
        mockStep({ type: 'action', toolName: 'some_tool', toolInput: undefined, timestamp: 1 }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      const grouped = component.groupedSteps();
      expect(grouped[0].rawAction).toBe('some_tool()');
    });
  });

  // ---------------------------------------------------------------------------
  // summarizeObservation edge cases
  // ---------------------------------------------------------------------------

  describe('summarizeObservation', () => {
    it('should return undefined for empty content (falsy observation skipped)', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'search_hn',
          toolInput: { query: 'x' },
          timestamp: 1,
        }),
        mockStep({ type: 'observation', content: '', timestamp: 2 }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      const grouped = component.groupedSteps();
      expect(grouped[0].observation).toBeUndefined();
    });

    it('should truncate long content without story/comment patterns', () => {
      const longContent = 'A'.repeat(100);
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'get_story',
          toolInput: { id: 1 },
          timestamp: 1,
        }),
        mockStep({ type: 'observation', content: longContent, timestamp: 2 }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      const grouped = component.groupedSteps();
      expect(grouped[0].observation!.length).toBeLessThanOrEqual(80);
      expect(grouped[0].observation!.endsWith('...')).toBe(true);
    });

    it('should count comments from observation', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'get_comments',
          toolInput: { storyId: 1 },
          timestamp: 1,
        }),
        mockStep({
          type: 'observation',
          content: 'Fetched 25 comments from the thread',
          timestamp: 2,
        }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      const grouped = component.groupedSteps();
      expect(grouped[0].observation).toBe('Read 25 comments');
    });

    it('should return "No results" for standalone empty observation', () => {
      const steps: AgentStep[] = [mockStep({ type: 'observation', content: '  ', timestamp: 1 })];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      const grouped = component.groupedSteps();
      expect(grouped[0].summary).toBe('No results');
    });
  });

  // ---------------------------------------------------------------------------
  // iconForTool edge cases
  // ---------------------------------------------------------------------------

  describe('iconForTool', () => {
    it('should return search for search_hn', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'search_hn',
          toolInput: { query: 'x' },
          timestamp: 1,
        }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      expect(component.groupedSteps()[0].icon).toBe('search');
    });

    it('should return read for get_comments', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'get_comments',
          toolInput: { storyId: 1 },
          timestamp: 1,
        }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      expect(component.groupedSteps()[0].icon).toBe('read');
    });

    it('should return thought for unknown tool', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'unknown_tool',
          toolInput: {},
          timestamp: 1,
        }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      expect(component.groupedSteps()[0].icon).toBe('thought');
    });

    it('should return thought when toolName is undefined', () => {
      const steps: AgentStep[] = [mockStep({ type: 'action', content: 'raw', timestamp: 1 })];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      expect(component.groupedSteps()[0].icon).toBe('thought');
    });
  });

  // ---------------------------------------------------------------------------
  // summarizeAction edge cases
  // ---------------------------------------------------------------------------

  describe('summarizeAction for unknown tool', () => {
    it('should return "Called toolname" for unknown tools', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'custom_tool',
          toolInput: {},
          timestamp: 1,
        }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      expect(component.groupedSteps()[0].summary).toBe('Called custom_tool');
    });

    it('should return "Called unknown tool" when toolName is missing', () => {
      const steps: AgentStep[] = [mockStep({ type: 'action', content: 'raw', timestamp: 1 })];
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      expect(component.groupedSteps()[0].summary).toBe('Called unknown tool');
    });
  });

  // ---------------------------------------------------------------------------
  // Template rendering -- pipeline mode DOM
  // ---------------------------------------------------------------------------

  describe('template rendering - pipeline mode', () => {
    it('should render pipeline progress section when isPipelineMode is true', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'done', detail: '3 themes', elapsed: 5000 },
      ]);
      fixture.detectChanges();

      expect(el.querySelector('[aria-label="Pipeline progress"]')).toBeTruthy();
      expect(el.textContent).toContain('retriever');
    });

    it('should render stage names in pipeline mode', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'done', detail: '', elapsed: 5000 },
        { stage: 'synthesizer', status: 'started', detail: 'analyzing', elapsed: 0 },
      ]);
      fixture.detectChanges();

      expect(el.textContent).toContain('retriever');
      expect(el.textContent).toContain('synthesizer');
    });

    it('should show waiting placeholders for pending stages', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'started', detail: '', elapsed: 0 },
      ]);
      fixture.detectChanges();

      expect(el.textContent).toContain('Waiting');
    });

    it('should show elapsed time for completed stages', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'done', detail: '3 themes from 5 sources', elapsed: 5000 },
      ]);
      fixture.detectChanges();

      expect(el.textContent).toContain('5.0s');
    });

    it('should show stage detail text for done stages', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'done', detail: '3 themes from 5 sources', elapsed: 5000 },
      ]);
      fixture.detectChanges();

      expect(el.textContent).toContain('3 themes from 5 sources');
    });

    it('should show in-progress detail text for active stages', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'started', detail: 'Searching HN...', elapsed: 0 },
      ]);
      fixture.detectChanges();

      expect(el.textContent).toContain('Searching HN...');
    });

    it('should show tool calls section when steps exist in pipeline mode', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'search_hn',
          toolInput: { query: 'test' },
          timestamp: 1,
        }),
        mockStep({ type: 'observation', content: '[1] "Story"', timestamp: 2 }),
      ];
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'started', detail: '', elapsed: 0 },
      ]);
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      expect(el.textContent).toContain('1 tool calls');
    });

    it('should expand inner steps when collapsed toggle is clicked', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'search_hn',
          toolInput: { query: 'test' },
          timestamp: 1,
        }),
        mockStep({ type: 'observation', content: '[1] "Story"', timestamp: 2 }),
      ];
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'started', detail: '', elapsed: 0 },
      ]);
      fixture.componentRef.setInput('steps', steps);
      fixture.detectChanges();

      // Initially collapsed
      expect(component.innerStepsCollapsed()).toBe(true);

      // Click the toggle button
      component.innerStepsCollapsed.set(false);
      fixture.detectChanges();

      // Should now show step summaries
      expect(el.textContent).toContain('Searched HN');
    });

    it('should render ReAct mode when isPipelineMode is false', () => {
      fixture.componentRef.setInput('isPipelineMode', false);
      fixture.componentRef.setInput('steps', [
        mockStep({ type: 'thought', content: 'thinking', timestamp: 1 }),
      ]);
      fixture.detectChanges();

      expect(el.querySelector('[aria-label="Agent reasoning steps"]')).toBeTruthy();
      expect(el.querySelector('[aria-label="Pipeline progress"]')).toBeNull();
    });

    it('should show raw details in template when expanded', () => {
      const steps: AgentStep[] = [
        mockStep({
          type: 'action',
          toolName: 'search_hn',
          toolInput: { query: 'test' },
          timestamp: 1,
        }),
        mockStep({ type: 'observation', content: '[1] "Result"', timestamp: 2 }),
      ];
      fixture.componentRef.setInput('steps', steps);
      fixture.componentRef.setInput('isPipelineMode', false);
      fixture.detectChanges();

      // Expand raw details
      component.toggleRaw(0);
      fixture.detectChanges();

      expect(el.textContent).toContain('search_hn(query: "test")');
      expect(el.textContent).toContain('Hide raw');
    });

    it('should render error stage icon correctly', () => {
      fixture.componentRef.setInput('isPipelineMode', true);
      fixture.componentRef.setInput('pipelineEvents', [
        { stage: 'retriever', status: 'error', detail: 'failed', elapsed: 1000 },
      ]);
      fixture.detectChanges();

      // Check for error stage in DOM -- the error icon SVG has text-trust-danger
      const errorIcon = el.querySelector('.text-trust-danger');
      expect(errorIcon).toBeTruthy();
    });
  });
});
