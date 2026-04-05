import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { AgentSource } from '@voxpopuli/shared-types';

/**
 * Displays a single Hacker News story referenced as a source in the agent's answer.
 *
 * The entire card is clickable and opens the HN discussion page in a new tab.
 * The title links to the story's original URL when available, otherwise to the
 * HN discussion page.
 */
@Component({
  selector: 'vp-source-card',
  standalone: true,
  templateUrl: './source-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceCardComponent {
  /** The HN source story to display. */
  readonly source = input.required<AgentSource>();

  /** Canonical HN discussion URL for this story. */
  readonly hnUrl = computed(() => `https://news.ycombinator.com/item?id=${this.source().storyId}`);

  /** URL the title should link to: original URL if present, otherwise HN link. */
  readonly titleUrl = computed(() => this.source().url || this.hnUrl());
}
