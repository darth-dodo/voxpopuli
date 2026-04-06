import { Component, computed, input, signal } from '@angular/core';
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
  /** Agent reasoning steps to render. */
  readonly steps = input<AgentStep[]>([]);

  /** Whether the agent is still producing steps. */
  readonly isStreaming = input<boolean>(false);

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
        const id = input['id'] ?? input['storyId'] ?? '';
        return `Fetched story #${id}`;
      }
      case 'get_comments': {
        const id = input['storyId'] ?? input['id'] ?? '';
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
