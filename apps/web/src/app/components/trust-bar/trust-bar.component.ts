import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TrustMetadata } from '@voxpopuli/shared-types';

/**
 * Displays trust metadata as a user-friendly summary bar.
 *
 * Shows source verification, recency, viewpoint diversity, and
 * Show HN bias warnings in plain language.
 */
@Component({
  selector: 'app-trust-bar',
  standalone: true,
  templateUrl: './trust-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrustBarComponent {
  /** Trust metadata computed by the agent pipeline. */
  readonly trust = input.required<TrustMetadata>();

  // ── Verified sources ──

  readonly verifiedLabel = computed(() => {
    const t = this.trust();
    if (t.sourcesTotal === 0) return 'No sources';
    if (t.sourcesVerified === t.sourcesTotal) return `All ${t.sourcesTotal} sources verified`;
    return `${t.sourcesVerified} of ${t.sourcesTotal} verified`;
  });

  readonly verifiedColor = computed(() => {
    const t = this.trust();
    if (t.sourcesTotal === 0) return 'text-text-muted';
    return t.sourcesVerified === t.sourcesTotal ? 'text-trust-verified' : 'text-trust-caution';
  });

  // ── Recency ──

  readonly recencyLabel = computed(() => {
    const t = this.trust();
    const pct = Math.round(t.recentSourceRatio * 100);
    if (t.sourcesTotal === 0) return 'No date info';
    if (pct === 0 && t.avgSourceAge === 0) return 'Age unknown';
    if (pct >= 75) return 'Mostly recent sources';
    if (pct >= 50) return 'Mix of old and new';
    if (pct > 0) return 'Mostly older sources';
    return t.avgSourceAge > 0 ? `Avg ${Math.round(t.avgSourceAge)} days old` : 'Age unknown';
  });

  readonly recencyColor = computed(() => {
    const t = this.trust();
    if (t.sourcesTotal === 0 || (t.recentSourceRatio === 0 && t.avgSourceAge === 0))
      return 'text-text-muted';
    const pct = t.recentSourceRatio * 100;
    if (pct >= 75) return 'text-trust-verified';
    if (pct >= 50) return 'text-accent-amber';
    return 'text-trust-caution';
  });

  // ── Diversity ──

  readonly diversityLabel = computed(() => {
    switch (this.trust().viewpointDiversity) {
      case 'balanced':
        return 'Multiple viewpoints';
      case 'one-sided':
        return 'One-sided perspective';
      case 'contested':
        return 'Actively debated';
    }
  });

  readonly diversityColor = computed(() => {
    switch (this.trust().viewpointDiversity) {
      case 'balanced':
        return 'text-trust-verified';
      case 'one-sided':
        return 'text-trust-caution';
      case 'contested':
        return 'text-accent-blue';
    }
  });

  // ── Show HN ──

  readonly showHnLabel = computed(() => {
    const count = this.trust().showHnCount;
    return count === 1
      ? '1 Show HN post (may be biased)'
      : `${count} Show HN posts (may be biased)`;
  });

  /** Format a snake_case honesty flag as a readable label. */
  formatFlag(flag: string): string {
    return flag.replace(/_/g, ' ');
  }
}
