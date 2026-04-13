import {
  Component,
  type OnInit,
  type OnDestroy,
  inject,
  signal,
  computed,
  model,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MarkdownComponent } from 'ngx-markdown';
import type { Subscription } from 'rxjs';
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
    NgTemplateOutlet,
    FormsModule,
    MarkdownComponent,
    AgentStepsComponent,
    SourceCardComponent,
    TrustBarComponent,
    ProviderSelectorComponent,
    MetaBarComponent,
  ],
  templateUrl: './chat.component.html',
})
export class ChatComponent implements OnInit, OnDestroy {
  private readonly ragService = inject(RagService);

  /** Whether the page was backgrounded while a stream was active. */
  readonly wasBackgrounded = signal(false);

  /** Bound reference to the visibility-change handler for cleanup. */
  private readonly onVisibilityChange = this.handleVisibilityChange.bind(this);

  /** Active SSE subscription, kept so cancel() can tear it down. */
  private streamSub: Subscription | null = null;

  /** Timer handle for the delayed retry after returning from background. */
  private backgroundRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Interval handle for the elapsed-time counter shown during streaming. */
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  /** Wall-clock timestamp when the current stream started. */
  private streamStartTime = 0;

  /** Elapsed seconds since the current query was submitted. */
  readonly elapsedSeconds = signal(0);

  /** Current theme ('dark' | 'light'). */
  readonly theme = signal<'dark' | 'light'>('dark');

  /** Example queries displayed on the landing page. */
  readonly exampleQueries = [
    'What are the top trends on HN this week?',
    'What does HN think about FastAPI?',
    'What Show HN projects got the most traction?',
    'Best HN discussions about remote work?',
    'How is TypeScript shaping backend development?',
    'Most controversial HN discussions this month?',
  ];

  /** Toggle between dark and light themes. */
  toggleTheme(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    document.documentElement.className = next;
  }

  /** Initialize default theme on document root and register visibility listener. */
  ngOnInit(): void {
    document.documentElement.className = 'dark';
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Clean up the visibility-change listener, active stream, and any pending timers. */
  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.streamSub?.unsubscribe();
    if (this.backgroundRetryTimer !== null) {
      clearTimeout(this.backgroundRetryTimer);
      this.backgroundRetryTimer = null;
    }
    this.stopElapsedTimer();
  }

  /**
   * Handle transitions between foreground and background.
   *
   * When the page is hidden during an active stream, a flag is set so that
   * on return we can distinguish a background-induced error from a normal one.
   * When the page becomes visible again and the stream has errored while
   * backgrounded, we show a user-friendly message with the collected context
   * preserved — the user can choose to retry manually.
   *
   * We deliberately do NOT auto-retry because:
   * 1. Retrying calls `submit()` which wipes all collected pipeline events and steps.
   * 2. Each retry starts a new server-side agent run, wasting resources.
   * 3. The user may have useful partial results from before the interruption.
   */
  private handleVisibilityChange(): void {
    if (document.hidden) {
      // Page is being backgrounded
      if (this.isStreaming()) {
        this.wasBackgrounded.set(true);
      }
    } else {
      // Page is returning to the foreground
      if (this.wasBackgrounded()) {
        this.wasBackgrounded.set(false);

        if (this.error() && !this.isStreaming()) {
          // The stream errored while we were away — show a friendlier message
          // but preserve collected steps / pipeline events for the fallback UI.
          this.error.set('Connection interrupted while in the background. Tap retry to try again.');
        }
      }
    }
  }

  /** Current query string bound to the input field. */
  readonly query = signal('');

  /** Whether a request is currently in flight. */
  readonly loading = signal(false);

  /** Error message from the most recent failed request, or null. */
  readonly error = signal<string | null>(null);

  /** Most recent successful agent response, or null. */
  readonly response = signal<AgentResponse | null>(null);

  /** Currently selected LLM provider. */
  readonly selectedProvider = model('mistral');

  /** Agent reasoning steps accumulated during streaming. */
  readonly steps = signal<AgentStep[]>([]);

  /** Whether the SSE stream is actively producing events. */
  readonly isStreaming = signal(false);

  /** Pipeline stage events accumulated during multi-agent streaming. */
  readonly pipelineEvents = signal<
    Array<{ stage: string; status: string; detail: string; elapsed: number }>
  >([]);

  /** Whether the current stream is using multi-agent pipeline mode. */
  readonly isPipelineMode = signal(false);

  /** Token content accumulated during pipeline streaming. */
  readonly tokenContent = signal('');

  /** Whether the answer was recently copied to clipboard. */
  readonly copied = signal(false);

  /** Human-readable status message derived from the latest pipeline event. */
  readonly pipelineStatusMessage = computed(() => {
    const events = this.pipelineEvents();
    if (events.length === 0) return 'Starting pipeline...';
    const latest = events[events.length - 1];
    switch (latest.stage) {
      case 'retriever':
        return latest.status === 'done'
          ? 'Evidence collected. Analyzing...'
          : 'Searching HN and collecting evidence...';
      case 'synthesizer':
        return latest.status === 'done'
          ? 'Analysis complete. Writing response...'
          : 'Analyzing themes and extracting insights...';
      case 'writer':
        return latest.status === 'done' ? 'Response ready.' : 'Composing your answer...';
      default:
        return 'Processing...';
    }
  });

  /** Currently active tab in the result view. */
  readonly activeTab = signal<'answer' | 'sources' | 'steps'>('steps');

  /** Maximum query length exposed to the template. */
  readonly maxLength = MAX_QUERY_LENGTH;

  /** Current character count for the counter display. */
  readonly charCount = computed(() => this.query().length);

  /**
   * Answer text with story IDs and usernames converted to clickable HN links.
   * - Story references like "Story 12345" or "(12345)" become links to HN items
   * - Usernames after "by" or "user" become links to HN user profiles
   */
  readonly enrichedAnswer = computed(() => {
    const res = this.response();
    if (!res) return '';
    let text = res.answer;

    // Convert story ID references: "Story 12345", "story 12345", "(12345)", "[12345]"
    text = text.replace(
      /(?:(?:[Ss]tory\s+)(\d{5,10})|\[(\d{5,10})\]|\((\d{5,10})\))/g,
      (match, id1, id2, id3) => {
        const id = id1 ?? id2 ?? id3;
        return `[${match}](https://news.ycombinator.com/item?id=${id})`;
      },
    );

    return text;
  });

  /**
   * Extract a readable summary from collected steps when the agent
   * errors out without producing a final answer.
   */
  readonly collectedContext = computed(() => {
    const allSteps = this.steps();
    if (allSteps.length === 0) return null;

    const observations = allSteps
      .filter((s) => s.type === 'observation')
      .map((s) => s.content)
      .filter((c) => c && !c.includes('No results found'));

    if (observations.length === 0) return null;

    // Extract story titles from observations
    const titles: string[] = [];
    for (const obs of observations) {
      const matches = obs.match(/\] "([^"]+)"/g);
      if (matches) {
        for (const m of matches) {
          const title = m.replace(/^\] "/, '').replace(/"$/, '');
          if (!titles.includes(title)) titles.push(title);
        }
      }
    }

    return {
      stepCount: allSteps.length,
      storyCount: titles.length,
      titles: titles.slice(0, 5),
    };
  });

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
    this.pipelineEvents.set([]);
    this.isPipelineMode.set(false);
    this.tokenContent.set('');
    this.activeTab.set('steps');
    this.startElapsedTimer();

    this.streamSub?.unsubscribe();
    this.streamSub = this.ragService.stream(q, this.selectedProvider(), true).subscribe({
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
            this.stopElapsedTimer();
            // Auto-switch to answer tab when answer arrives
            this.activeTab.set('answer');
            break;
          case 'pipeline':
            this.isPipelineMode.set(true);
            this.pipelineEvents.update((events) => [
              ...events,
              {
                stage: event.stage,
                status: event.status,
                detail: event.detail,
                elapsed: event.elapsed,
              },
            ]);
            break;
          case 'token':
            this.tokenContent.update((content) => content + event.content);
            break;
          case 'error':
            this.error.set(event.message);
            this.isStreaming.set(false);
            this.loading.set(false);
            this.stopElapsedTimer();
            this.stopActiveStages('Error');
            this.activeTab.set('answer');
            break;
        }
      },
      error: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Something went wrong. Please try again.';
        this.error.set(message);
        this.isStreaming.set(false);
        this.loading.set(false);
        this.stopElapsedTimer();
        this.stopActiveStages('Connection lost');
        this.activeTab.set('answer');
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

  /** Copy the answer text to clipboard. */
  copyAnswer(): void {
    const res = this.response();
    if (!res) return;
    navigator.clipboard.writeText(res.answer).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  /**
   * Start a 1-second interval that computes elapsed time from a wall-clock
   * timestamp. Unlike an increment-based counter this is resilient to mobile
   * browsers throttling or pausing `setInterval` when backgrounded — the
   * displayed value jumps to the correct elapsed on resume.
   */
  private startElapsedTimer(): void {
    this.stopElapsedTimer();
    this.streamStartTime = Date.now();
    this.elapsedSeconds.set(0);
    this.elapsedTimer = setInterval(() => {
      this.elapsedSeconds.set(Math.floor((Date.now() - this.streamStartTime) / 1000));
    }, 1000);
  }

  /** Stop the elapsed-time interval. */
  private stopElapsedTimer(): void {
    if (this.elapsedTimer !== null) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  /**
   * Mark any in-progress pipeline stages as stopped so their icons and timers
   * reflect that the stream is no longer active. Called on cancel, SSE error,
   * and stall detection.
   */
  private stopActiveStages(detail: string): void {
    const elapsedMs = Date.now() - this.streamStartTime;
    this.pipelineEvents.update((events) =>
      events.map((e) =>
        e.status === 'started' ? { ...e, status: 'error', detail, elapsed: elapsedMs } : e,
      ),
    );
  }

  /**
   * Cancel the active SSE stream. Collected steps and pipeline events are
   * preserved so the fallback UI can display what was gathered before cancel.
   */
  cancel(): void {
    if (this.streamSub) {
      this.streamSub.unsubscribe();
      this.streamSub = null;
    }
    this.isStreaming.set(false);
    this.loading.set(false);
    this.stopElapsedTimer();
    this.stopActiveStages('Cancelled');
    this.error.set('Query cancelled.');
    this.activeTab.set('answer');
  }

  /** Retry the current query. */
  retry(): void {
    this.submit();
  }

  /** Smooth-scroll back to the search bar at the top of the page. */
  scrollToTop(): void {
    document.getElementById('query-input')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /** Reset to the landing page state. */
  goHome(): void {
    this.streamSub?.unsubscribe();
    this.streamSub = null;
    this.query.set('');
    this.response.set(null);
    this.error.set(null);
    this.steps.set([]);
    this.pipelineEvents.set([]);
    this.stopElapsedTimer();
    this.isPipelineMode.set(false);
    this.tokenContent.set('');
    this.loading.set(false);
    this.isStreaming.set(false);
    this.activeTab.set('steps');
  }
}
