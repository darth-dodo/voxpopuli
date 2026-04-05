import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AgentResponse, AgentStep } from '@voxpopuli/shared-types';
import { RagService, StreamEvent } from '../../services/rag.service';
import { AgentStepsComponent } from '../agent-steps/agent-steps.component';
import { SourceCardComponent } from '../source-card/source-card.component';
import { TrustBarComponent } from '../trust-bar/trust-bar.component';
import { ProviderSelectorComponent } from '../provider-selector/provider-selector.component';
import { MetaBarComponent } from '../meta-bar/meta-bar.component';

/** Maximum character length for a user query. */
const MAX_QUERY_LENGTH = 500;

/**
 * ChatComponent -- main chat interface for VoxPopuli.
 *
 * Renders a query input with character counter, an answer display area
 * with editorial prose styling, and loading / error / empty states.
 * Sub-components display agent steps, trust metadata, source cards,
 * and provider selection. Communicates with the backend via SSE streaming
 * through {@link RagService}.
 */
@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    FormsModule,
    AgentStepsComponent,
    SourceCardComponent,
    TrustBarComponent,
    ProviderSelectorComponent,
    MetaBarComponent,
  ],
  templateUrl: './chat.component.html',
})
export class ChatComponent {
  private readonly ragService = inject(RagService);

  /** Current query string bound to the input field. */
  readonly query = signal('');

  /** Whether a request is currently in flight. */
  readonly loading = signal(false);

  /** Error message from the most recent failed request, or null. */
  readonly error = signal<string | null>(null);

  /** Most recent successful agent response, or null. */
  readonly response = signal<AgentResponse | null>(null);

  /** Currently selected LLM provider. */
  readonly selectedProvider = signal('groq');

  /** Agent reasoning steps accumulated during streaming. */
  readonly steps = signal<AgentStep[]>([]);

  /** Whether the SSE stream is actively producing events. */
  readonly isStreaming = signal(false);

  /** Maximum query length exposed to the template. */
  readonly maxLength = MAX_QUERY_LENGTH;

  /** Current character count for the counter display. */
  readonly charCount = computed(() => this.query().length);

  /** Whether the submit button should be disabled. */
  readonly submitDisabled = computed(
    () =>
      this.loading() || this.query().trim().length === 0 || this.query().length > MAX_QUERY_LENGTH,
  );

  /**
   * Submit the current query to the RAG pipeline via SSE streaming.
   * Accumulates agent steps as they arrive and renders the final
   * answer once the stream completes.
   */
  submit(): void {
    const q = this.query().trim();
    if (!q || q.length > MAX_QUERY_LENGTH || this.loading()) {
      return;
    }

    this.loading.set(true);
    this.isStreaming.set(true);
    this.error.set(null);
    this.response.set(null);
    this.steps.set([]);

    this.ragService.stream(q, this.selectedProvider()).subscribe({
      next: (event: StreamEvent) => {
        switch (event.type) {
          case 'thought':
            this.steps.update((prev) => [
              ...prev,
              { type: 'thought', content: event.content, timestamp: event.timestamp },
            ]);
            break;
          case 'action':
            this.steps.update((prev) => [
              ...prev,
              {
                type: 'action',
                content: event.toolName,
                toolName: event.toolName,
                toolInput: event.toolInput,
                timestamp: event.timestamp,
              },
            ]);
            break;
          case 'observation':
            this.steps.update((prev) => [
              ...prev,
              { type: 'observation', content: event.content, timestamp: event.timestamp },
            ]);
            break;
          case 'answer':
            this.response.set(event.response);
            this.isStreaming.set(false);
            this.loading.set(false);
            break;
          case 'error':
            this.error.set(event.message);
            this.isStreaming.set(false);
            this.loading.set(false);
            break;
        }
      },
      error: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Something went wrong. Please try again.';
        this.error.set(message);
        this.isStreaming.set(false);
        this.loading.set(false);
      },
      complete: () => {
        this.isStreaming.set(false);
      },
    });
  }

  /**
   * Handle keydown events on the query input.
   * Submits the query when the user presses Enter.
   */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.submit();
    }
  }
}
