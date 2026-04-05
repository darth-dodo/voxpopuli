import { Component, computed, input, signal } from '@angular/core';
import type { AgentStep } from '@voxpopuli/shared-types';

/** Maximum number of agent steps allowed per run. */
const MAX_STEPS = 7;

/** Line count threshold above which observation content is collapsed by default. */
const COLLAPSE_LINE_THRESHOLD = 3;

/**
 * Displays a vertical timeline of ReAct agent reasoning steps in a
 * terminal-style container. Each step renders with a typed badge
 * (thought / action / observation) and contextual content.
 *
 * Observation content is collapsible when it exceeds three lines.
 * The entire step list can be collapsed via the header toggle.
 * A blinking cursor appears after the last step while streaming.
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

  /** Whether the entire step list is collapsed. */
  readonly collapsed = signal(false);

  /** Set of step indices whose observation content is expanded. */
  readonly expandedObservations = signal<Set<number>>(new Set());

  /** Human-readable step counter, e.g. "Step 3 / 7". */
  readonly stepCounter = computed(() => {
    const count = Math.min(this.steps().length, MAX_STEPS);
    return `Step ${count} / ${MAX_STEPS}`;
  });

  /** Toggle visibility of the entire step list. */
  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  /** Toggle expand/collapse for a specific observation step. */
  toggleObservation(index: number): void {
    this.expandedObservations.update((set) => {
      const next = new Set(set);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  /** Whether a given observation index is currently expanded. */
  isObservationExpanded(index: number): boolean {
    return this.expandedObservations().has(index);
  }

  /** Whether an observation's content exceeds the collapse threshold. */
  isLongObservation(content: string): boolean {
    return content.split('\n').length > COLLAPSE_LINE_THRESHOLD;
  }

  /**
   * Format tool input as a compact inline string.
   * e.g. `{ query: "tailwind", max: 5 }` becomes `query: "tailwind", max: 5`
   */
  formatToolInput(toolInput: Record<string, unknown> | undefined): string {
    if (!toolInput) return '';
    return Object.entries(toolInput)
      .map(([key, value]) =>
        typeof value === 'string' ? `${key}: "${value}"` : `${key}: ${String(value)}`,
      )
      .join(', ');
  }

  /**
   * Convert a tool action into a human-friendly description.
   * e.g. search_hn with query "Rust" -> "Searching HN for "Rust""
   */
  formatAction(step: AgentStep): string {
    const toolName = step.toolName ?? '';
    const input = step.toolInput as Record<string, unknown> | undefined;

    switch (toolName) {
      case 'search_hn': {
        const query = input?.['query'] ?? '';
        return `Searching HN for \u201c${query}\u201d`;
      }
      case 'get_story': {
        const id = input?.['story_id'] ?? input?.['storyId'] ?? '';
        return `Fetching story #${id}`;
      }
      case 'get_comments': {
        const id = input?.['story_id'] ?? input?.['storyId'] ?? '';
        return `Reading comments on story #${id}`;
      }
      default:
        return `Running ${toolName}`;
    }
  }

  /**
   * Convert an observation into a human-friendly summary.
   * Extracts story count from raw output or returns a short version.
   */
  formatObservation(content: string): string {
    if (content.includes('No results found')) {
      return 'No results \u2014 trying a different search\u2026';
    }

    // Count stories in output
    const storyMatches = content.match(/\[\d+\]/g);
    if (storyMatches) {
      return `Found ${storyMatches.length} ${storyMatches.length === 1 ? 'story' : 'stories'}`;
    }

    // Count comments
    const commentMatch = content.match(/COMMENTS.*?(\d+)\s+total/);
    if (commentMatch) {
      return `Found ${commentMatch[1]} comments`;
    }

    // Truncate long content
    if (content.length > 80) {
      return content.slice(0, 77) + '...';
    }

    return content;
  }
}
