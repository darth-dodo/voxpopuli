import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TrustMetadata } from '@voxpopuli/shared-types';

/** Color token class for trust-level indicators. */
type TrustColor =
  | 'text-trust-verified'
  | 'text-trust-caution'
  | 'text-trust-warning'
  | 'text-trust-danger'
  | 'text-accent-blue';

/**
 * Displays trust metadata as a row of indicator chips.
 *
 * Four indicators are rendered (Show HN only when count > 0):
 * - Sources verified (shield icon)
 * - Recency ratio (clock icon)
 * - Viewpoint diversity (scale icon)
 * - Show HN count (exclamation-triangle icon)
 *
 * Honesty flags, if present, render as muted text beneath the chips.
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

  // ── Derived values ──

  /** Human-readable verification label. */
  readonly verifiedLabel = computed(
    () => `${this.trust().sourcesVerified}/${this.trust().sourcesTotal} verified`,
  );

  /** Color class for the verification indicator. */
  readonly verifiedColor = computed<TrustColor>(() =>
    this.trust().sourcesVerified === this.trust().sourcesTotal
      ? 'text-trust-verified'
      : 'text-trust-caution',
  );

  /** Recency as a whole-number percentage. */
  readonly recencyPercent = computed(() => Math.round(this.trust().recentSourceRatio * 100));

  /** Human-readable recency label. */
  readonly recencyLabel = computed(() => `${this.recencyPercent()}% recent`);

  /** Color class for the recency indicator. */
  readonly recencyColor = computed<TrustColor>(() => {
    const pct = this.recencyPercent();
    if (pct > 75) return 'text-trust-verified';
    if (pct >= 50) return 'text-trust-caution';
    return 'text-trust-warning';
  });

  /** Color class for the viewpoint diversity indicator. */
  readonly diversityColor = computed<TrustColor>(() => {
    switch (this.trust().viewpointDiversity) {
      case 'balanced':
        return 'text-trust-verified';
      case 'one-sided':
        return 'text-trust-caution';
      case 'contested':
        return 'text-accent-blue';
    }
  });

  /** Human-readable Show HN label. */
  readonly showHnLabel = computed(() => `${this.trust().showHnCount} Show HN`);

  /** Format a snake_case honesty flag as a readable label. */
  formatFlag(flag: string): string {
    return flag.replace(/_/g, ' ');
  }
}
