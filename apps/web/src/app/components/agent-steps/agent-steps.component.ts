import { Component, computed, effect, input, signal, DestroyRef, inject } from '@angular/core';
import type { AgentStep } from '@voxpopuli/shared-types';

/**
 * Displays agent reasoning steps as human-readable cards.
 * Each step shows a numbered label, icon, summary, and optional
 * observation result. A "Show raw" toggle reveals the original
 * tool call syntax for debugging.
 */
@Component({
  selector: 'app-agent-steps',
  standalone: true,
  templateUrl: './agent-steps.component.html',
})
export class AgentStepsComponent {
  private readonly destroyRef = inject(DestroyRef);

  /** Agent reasoning steps to render. */
  readonly steps = input<AgentStep[]>([]);

  /** Whether the agent is still producing steps. */
  readonly isStreaming = input<boolean>(false);

  /** Pipeline stage events from multi-agent mode. */
  readonly pipelineEvents = input<
    Array<{ stage: string; status: string; detail: string; elapsed: number }>
  >([]);

  /** Whether the component should render pipeline timeline instead of ReAct steps. */
  readonly isPipelineMode = input<boolean>(false);

  /** Tracks when each stage started (wall-clock timestamp). */
  private readonly stageStartTimes = new Map<string, number>();

  /** Live-ticking elapsed ms per active stage, updated every 100ms. */
  readonly liveElapsed = signal<Map<string, number>>(new Map());

  private tickInterval: ReturnType<typeof setInterval> | null = null;

  /** Pipeline stages grouped by name, ordered retriever → synthesizer → writer. */
  readonly pipelineStages = computed(() => {
    const events = this.pipelineEvents();
    const stageMap = new Map<
      string,
      { name: string; status: string; detail: string; elapsed: number }
    >();

    for (const event of events) {
      stageMap.set(event.stage, {
        name: event.stage,
        status: event.status,
        detail: event.detail,
        elapsed: event.elapsed,
      });
    }

    const stages: Array<{ name: string; status: string; detail: string; elapsed: number }> = [];
    for (const name of ['retriever', 'synthesizer', 'writer']) {
      const stage = stageMap.get(name);
      if (stage) stages.push(stage);
    }

    return stages;
  });

  /** Whether inner ReAct steps are collapsed (default: true). */
  readonly innerStepsCollapsed = signal(true);

  /** Total pipeline time based on sum of per-stage durations. */
  readonly totalPipelineTime = computed(() => {
    const stages = this.pipelineStages();
    if (stages.length === 0) return 0;
    return stages.reduce((sum, s) => sum + s.elapsed, 0);
  });

  /**
   * Display elapsed for a stage: final duration if done, live counter if active.
   */
  stageElapsed(stage: { name: string; status: string; elapsed: number }): number {
    if (stage.status === 'done' || stage.status === 'error') {
      return stage.elapsed;
    }
    return this.liveElapsed().get(stage.name) ?? 0;
  }

  constructor() {
    // Watch pipeline events to track stage start times and manage the tick interval
    effect(() => {
      const stages = this.pipelineStages();
      let hasActiveStage = false;

      for (const stage of stages) {
        if (stage.status === 'started' && !this.stageStartTimes.has(stage.name)) {
          this.stageStartTimes.set(stage.name, Date.now());
        }
        if (stage.status === 'done' || stage.status === 'error') {
          this.stageStartTimes.delete(stage.name);
        }
        if (stage.status === 'started') {
          hasActiveStage = true;
        }
      }

      if (hasActiveStage && !this.tickInterval) {
        this.startTicking();
      } else if (!hasActiveStage && this.tickInterval) {
        this.stopTicking();
      }
    });

    this.destroyRef.onDestroy(() => this.stopTicking());
  }

  private startTicking(): void {
    this.tickInterval = setInterval(() => {
      const now = Date.now();
      const updated = new Map<string, number>();
      for (const [name, startTime] of this.stageStartTimes) {
        updated.set(name, now - startTime);
      }
      this.liveElapsed.set(updated);
    }, 100);
  }

  private stopTicking(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /** Parsed stage details as structured chip data for badge rendering. */
  readonly parsedStageDetails = computed(() => {
    const stages = this.pipelineStages();
    const parsed = new Map<string, Array<{ label: string; value: string; color: string }>>();

    for (const stage of stages) {
      if (stage.status !== 'done' || !stage.detail) continue;
      const chips: Array<{ label: string; value: string; color: string }> = [];

      if (stage.name === 'retriever') {
        const match = stage.detail.match(/(\d+) themes? from (\d+) sources?/);
        if (match) {
          chips.push({ label: 'themes', value: match[1], color: 'text-accent-amber' });
          chips.push({ label: 'sources', value: match[2], color: 'text-text-secondary' });
        }
        const tokenMatch = stage.detail.match(/~(\d+) tokens/);
        if (tokenMatch) {
          chips.push({ label: 'tokens', value: `~${tokenMatch[1]}`, color: 'text-text-muted' });
        }
      } else if (stage.name === 'synthesizer') {
        const insightMatch = stage.detail.match(/(\d+) insights?/);
        if (insightMatch)
          chips.push({ label: 'insights', value: insightMatch[1], color: 'text-accent-amber' });
        const contraMatch = stage.detail.match(/(\d+) contradictions?/);
        if (contraMatch && contraMatch[1] !== '0')
          chips.push({
            label: 'contradictions',
            value: contraMatch[1],
            color: 'text-trust-warning',
          });
        const confMatch = stage.detail.match(/confidence: (\w+)/);
        if (confMatch) {
          const confColor =
            confMatch[1] === 'high'
              ? 'text-trust-verified'
              : confMatch[1] === 'medium'
              ? 'text-accent-amber'
              : 'text-trust-danger';
          chips.push({ label: 'confidence', value: confMatch[1], color: confColor });
        }
      } else if (stage.name === 'writer') {
        const secMatch = stage.detail.match(/(\d+) sections?/);
        if (secMatch)
          chips.push({ label: 'sections', value: secMatch[1], color: 'text-accent-amber' });
        const srcMatch = stage.detail.match(/(\d+) sources? cited/);
        if (srcMatch)
          chips.push({ label: 'cited', value: srcMatch[1], color: 'text-text-secondary' });
      }

      parsed.set(stage.name, chips);
    }

    return parsed;
  });

  /** Set of step indices whose raw details are expanded. */
  readonly expandedRaw = signal<Set<number>>(new Set());

  /**
   * Group consecutive action+observation pairs into logical steps.
   * Thoughts are standalone. An action followed by an observation
   * forms one logical step.
   */
  readonly groupedSteps = computed(() => {
    const raw = this.steps();
    const groups: GroupedStep[] = [];
    let stepNum = 1;

    for (let i = 0; i < raw.length; i++) {
      const step = raw[i];

      if (step.type === 'thought') {
        groups.push({
          number: stepNum++,
          type: 'thought',
          summary: step.content,
          icon: 'thought',
          observation: undefined,
          rawAction: undefined,
          rawObservation: undefined,
        });
      } else if (step.type === 'action') {
        const nextStep = i + 1 < raw.length ? raw[i + 1] : undefined;
        const observation = nextStep?.type === 'observation' ? nextStep.content : undefined;
        if (nextStep?.type === 'observation') i++; // skip the observation

        groups.push({
          number: stepNum++,
          type: 'action',
          summary: this.summarizeAction(step),
          icon: this.iconForTool(step.toolName),
          observation: observation ? this.summarizeObservation(observation) : undefined,
          rawAction: this.formatRawAction(step),
          rawObservation: observation,
        });
      }
      // standalone observations (rare) get shown as-is
      else if (step.type === 'observation') {
        groups.push({
          number: stepNum++,
          type: 'observation',
          summary: this.summarizeObservation(step.content),
          icon: 'search',
          observation: undefined,
          rawAction: undefined,
          rawObservation: step.content,
        });
      }
    }

    return groups;
  });

  /** Toggle raw details for a specific step. */
  toggleRaw(index: number): void {
    this.expandedRaw.update((set) => {
      const next = new Set(set);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  /** Whether raw details are shown for a given step. */
  isRawExpanded(index: number): boolean {
    return this.expandedRaw().has(index);
  }

  /** Convert an action step into a human-readable summary. */
  private summarizeAction(step: AgentStep): string {
    const toolName = step.toolName ?? '';
    const input = step.toolInput ?? {};

    switch (toolName) {
      case 'search_hn': {
        const query = (input['query'] as string) ?? '*';
        return `Searched HN for "${query}"`;
      }
      case 'get_story': {
        const id = input['story_id'] ?? input['storyId'] ?? input['id'] ?? '';
        return `Fetched story #${id}`;
      }
      case 'get_comments': {
        const id = input['story_id'] ?? input['storyId'] ?? input['id'] ?? '';
        return `Fetched comments for story #${id}`;
      }
      default:
        return `Called ${toolName || 'unknown tool'}`;
    }
  }

  /** Summarize an observation into a short one-liner. */
  private summarizeObservation(content: string): string {
    if (!content || content.trim() === '') return 'No results';
    if (content.includes('No results found')) return 'No results found';

    // Count stories in observation
    const storyMatches = content.match(/\[\d+\]/g);
    if (storyMatches) {
      return `Found ${storyMatches.length} stories`;
    }

    // Count comments
    const commentMatch = content.match(/(\d+)\s*comments?/i);
    if (commentMatch) {
      return `Read ${commentMatch[1]} comments`;
    }

    // Truncate long observations
    const firstLine = content.split('\n')[0].trim();
    return firstLine.length > 80 ? firstLine.substring(0, 77) + '...' : firstLine;
  }

  /** Determine icon type based on tool name. */
  private iconForTool(toolName: string | undefined): 'search' | 'read' | 'thought' {
    switch (toolName) {
      case 'search_hn':
        return 'search';
      case 'get_story':
      case 'get_comments':
        return 'read';
      default:
        return 'thought';
    }
  }

  /** Format raw action for debugging display. */
  private formatRawAction(step: AgentStep): string {
    if (!step.toolName) return step.content;
    const args = step.toolInput
      ? Object.entries(step.toolInput)
          .map(([k, v]) => (typeof v === 'string' ? `${k}: "${v}"` : `${k}: ${String(v)}`))
          .join(', ')
      : '';
    return `${step.toolName}(${args})`;
  }
}

/** A logical grouping of agent steps for display. */
interface GroupedStep {
  number: number;
  type: 'thought' | 'action' | 'observation';
  summary: string;
  icon: 'search' | 'read' | 'thought';
  observation: string | undefined;
  rawAction: string | undefined;
  rawObservation: string | undefined;
}
