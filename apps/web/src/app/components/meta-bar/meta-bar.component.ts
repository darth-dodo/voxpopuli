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

  /** Latency formatted with locale separators. */
  readonly formattedDuration = computed(() => this.meta().durationMs.toLocaleString());

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
