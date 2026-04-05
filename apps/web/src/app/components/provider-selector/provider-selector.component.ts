import { Component, computed, model } from '@angular/core';

/** Descriptor for a single LLM provider option. */
interface ProviderOption {
  id: string;
  name: string;
  speed: string;
  cost: string;
}

/**
 * Chip-based selector that lets the user choose which LLM provider
 * powers the next RAG query.
 *
 * Uses Angular `model()` for two-way binding so the parent can
 * read and preset the selected provider.
 */
@Component({
  selector: 'app-provider-selector',
  standalone: true,
  templateUrl: './provider-selector.component.html',
})
export class ProviderSelectorComponent {
  /** Currently selected provider id (two-way bindable). */
  readonly selectedProvider = model<string>('groq');

  /** Available LLM providers. */
  readonly providers: readonly ProviderOption[] = [
    { id: 'groq', name: 'Groq', speed: 'Fastest', cost: 'Free tier' },
    { id: 'mistral', name: 'Mistral', speed: 'Moderate', cost: 'Low' },
    { id: 'claude', name: 'Claude', speed: 'Slower', cost: 'Higher' },
  ] as const;

  /** The currently active provider descriptor (derived). */
  readonly activeProvider = computed(
    () => this.providers.find((p) => p.id === this.selectedProvider()) ?? this.providers[0],
  );

  /** Select a provider by id. */
  select(id: string): void {
    this.selectedProvider.set(id);
  }
}
