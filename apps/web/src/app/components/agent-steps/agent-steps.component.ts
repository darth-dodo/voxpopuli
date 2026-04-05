import { Component, computed, input, signal } from '@angular/core';
import type { AgentStep } from '@voxpopuli/shared-types';

/** Maximum number of agent steps allowed per run. */
const MAX_STEPS = 7;

/** A merged action + its observation result (one row). */
interface MergedStep {
  action: AgentStep;
  observation: AgentStep | null;
}

/**
 * Compact timeline showing agent reasoning as merged action→result pairs.
 *
 * Each completed row: [checkmark] action description ... result summary
 * Pending actions show a pulsing spinner instead of a checkmark.
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

  /** Whether the step list is collapsed. */
  readonly collapsed = signal(false);

  /** Human-readable step counter. */
  readonly stepCounter = computed(() => {
    const actions = this.steps().filter((s) => s.type === 'action').length;
    const count = Math.min(actions, MAX_STEPS);
    return `${count} ${count === 1 ? 'step' : 'steps'}`;
  });

  /**
   * Merge action+observation pairs into single rows.
   * Only includes completed pairs (action followed by observation).
   */
  readonly mergedSteps = computed((): MergedStep[] => {
    const steps = this.steps();
    const merged: MergedStep[] = [];

    for (let i = 0; i < steps.length; i++) {
      if (steps[i].type === 'action') {
        const next = steps[i + 1];
        if (next?.type === 'observation') {
          merged.push({ action: steps[i], observation: next });
          i++; // skip the observation
        }
      }
    }

    return merged;
  });

  /** The last action that doesn't have an observation yet (still in-flight). */
  readonly pendingAction = computed((): AgentStep | null => {
    const steps = this.steps();
    if (steps.length === 0) return null;
    const last = steps[steps.length - 1];
    if (last.type === 'action') return last;
    return null;
  });

  /** Toggle collapsed state. */
  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  /** Convert a tool action into a human-friendly description. */
  formatAction(step: AgentStep): string {
    const toolName = step.toolName ?? '';
    const toolInput = step.toolInput as Record<string, unknown> | undefined;

    switch (toolName) {
      case 'search_hn': {
        const query = toolInput?.['query'] ?? '';
        return `Searching for \u201c${query}\u201d`;
      }
      case 'get_story': {
        const id = toolInput?.['story_id'] ?? toolInput?.['storyId'] ?? '';
        return `Reading story #${id}`;
      }
      case 'get_comments': {
        const id = toolInput?.['story_id'] ?? toolInput?.['storyId'] ?? '';
        return `Reading comments #${id}`;
      }
      default:
        return toolName || step.content;
    }
  }

  /** Convert an observation into a short result label. */
  formatObservation(content: string): string {
    if (content.includes('No results found') || content.includes('No story found')) {
      return 'no results';
    }

    // Count stories in search results (match [id] "Title" pattern)
    if (content.includes('=== STORIES ===')) {
      const matches = content.match(/\[\d+\]\s+"/g);
      if (matches) return `${matches.length} stories`;
    }

    // Count comments
    if (content.includes('=== COMMENTS ===')) {
      const matches = content.match(/\(depth \d+\)/g);
      if (matches) return `${matches.length} comments`;
    }

    // Single story fetch
    if (content.startsWith('[') && content.includes('" by ')) {
      return 'loaded';
    }

    return 'done';
  }
}
