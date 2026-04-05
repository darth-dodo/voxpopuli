import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgentResponse } from '@voxpopuli/shared-types';
import { RagService } from '../../services/rag.service';

/** Maximum character length for a user query. */
const MAX_QUERY_LENGTH = 500;

/**
 * ChatComponent -- main chat interface for VoxPopuli.
 *
 * Renders a query input with character counter, an answer display area
 * with editorial prose styling, and loading / error / empty states.
 * Communicates with the backend via {@link RagService}.
 */
@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule],
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
   * Submit the current query to the RAG pipeline.
   * Disables input while the request is in flight and renders
   * the answer or error once the observable completes.
   */
  submit(): void {
    const q = this.query().trim();
    if (!q || q.length > MAX_QUERY_LENGTH || this.loading()) {
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.ragService.query(q).subscribe({
      next: (res) => {
        this.response.set(res);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Something went wrong. Please try again.';
        this.error.set(message);
        this.loading.set(false);
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
