import { Component, computed, input } from '@angular/core';
import type { AgentMeta } from '@voxpopuli/shared-types';

/**
 * Displays response metadata (provider, token usage, latency, cache status)
 * as a compact monospace line after a RAG query completes.
 */
@Component({
  selector: 'app-meta-bar',
  standalone: true,
  templateUrl: './meta-bar.component.html',
})
export class MetaBarComponent {
  /** Agent run metadata to display. */
  readonly meta = input.required<AgentMeta>();

  /** Total tokens (input + output) formatted with locale separators. */
  readonly totalTokens = computed(() => {
    const m = this.meta();
    return (m.totalInputTokens + m.totalOutputTokens).toLocaleString();
  });

  /** Latency formatted as a human-readable duration string. */
  readonly formattedDuration = computed(() => {
    const ms = this.meta().durationMs;
    if (ms < 1_000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60_000);
    const secs = Math.round((ms % 60_000) / 1_000);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  });

  /**
   * CSS class for the latency value based on response time thresholds.
   *
   * - Green (< 5 000 ms): fast response
   * - Amber (5 000 -- 15 000 ms): moderate response
   * - Red (> 15 000 ms): slow response
   */
  readonly latencyColor = computed(() => {
    const ms = this.meta().durationMs;
    if (ms < 5_000) return 'text-trust-verified';
    if (ms <= 15_000) return 'text-accent-amber';
    return 'text-trust-danger';
  });
}
