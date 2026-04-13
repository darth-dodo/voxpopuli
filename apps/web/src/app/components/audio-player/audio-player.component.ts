import { Component, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { TtsService } from '../../services/tts.service';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'complete' | 'error';

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

@Component({
  selector: 'app-audio-player',
  standalone: true,
  templateUrl: './audio-player.component.html',
})
export class AudioPlayerComponent implements OnDestroy {
  private readonly ttsService = inject(TtsService);
  private subscription: Subscription | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private audioBlob: Blob | null = null;

  readonly text = input.required<string>();
  readonly disabled = input(false);

  readonly state = signal<PlayerState>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly playbackSpeed = signal(1);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly progress = computed(() => {
    const d = this.duration();
    return d > 0 ? (this.currentTime() / d) * 100 : 0;
  });

  readonly formattedTime = computed(() => this.formatTime(this.currentTime()));
  readonly formattedDuration = computed(() => this.formatTime(this.duration()));

  readonly isExpanded = computed(() => {
    const s = this.state();
    return s === 'playing' || s === 'paused' || s === 'complete';
  });

  /** Start narration from idle state. */
  onListen(): void {
    if (this.disabled() || this.state() === 'loading') return;
    this.startNarration();
  }

  /** Retry narration after an error. */
  onRetry(): void {
    this.startNarration();
  }

  /** Toggle between playing and paused states. */
  togglePlayPause(): void {
    if (!this.audioElement) return;

    if (this.state() === 'playing') {
      this.audioElement.pause();
      this.state.set('paused');
    } else if (this.state() === 'paused' || this.state() === 'complete') {
      if (this.state() === 'complete') {
        this.audioElement.currentTime = 0;
      }
      this.audioElement.play();
      this.state.set('playing');
    }
  }

  /** Cycle through playback speed options: 1x -> 1.25x -> 1.5x -> 0.75x -> 1x. */
  cycleSpeed(): void {
    const currentIndex = SPEED_OPTIONS.indexOf(
      this.playbackSpeed() as (typeof SPEED_OPTIONS)[number],
    );
    const nextIndex = (currentIndex + 1) % SPEED_OPTIONS.length;
    this.playbackSpeed.set(SPEED_OPTIONS[nextIndex]);
    if (this.audioElement) {
      this.audioElement.playbackRate = SPEED_OPTIONS[nextIndex];
    }
  }

  /** Download the narration audio as an MP3 file. */
  download(): void {
    if (!this.audioBlob) return;
    const url = URL.createObjectURL(this.audioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voxpopuli-narration.mp3';
    a.click();
    URL.revokeObjectURL(url);
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private startNarration(): void {
    this.cleanup();
    this.state.set('loading');
    this.errorMessage.set(null);

    this.subscription = this.ttsService.narrate(this.text(), true).subscribe({
      next: (result) => {
        this.audioBlob = result.blob;
        this.objectUrl = URL.createObjectURL(result.blob);
        this.setupAudio(this.objectUrl);
      },
      error: (err) => {
        this.state.set('error');
        this.errorMessage.set(err.message ?? 'Narration failed');
      },
    });
  }

  private setupAudio(url: string): void {
    this.audioElement = new Audio(url);
    this.audioElement.playbackRate = this.playbackSpeed();

    this.audioElement.addEventListener('canplay', () => {
      this.audioElement
        ?.play()
        .then(() => {
          this.state.set('playing');
        })
        .catch(() => {
          // Autoplay blocked — let user tap play
          this.state.set('paused');
        });
    });

    this.audioElement.addEventListener('timeupdate', () => {
      if (this.audioElement) {
        this.currentTime.set(this.audioElement.currentTime);
      }
    });

    this.audioElement.addEventListener('loadedmetadata', () => {
      if (this.audioElement) {
        this.duration.set(this.audioElement.duration);
      }
    });

    this.audioElement.addEventListener('ended', () => {
      this.state.set('complete');
    });

    this.audioElement.addEventListener('error', () => {
      this.state.set('error');
      this.errorMessage.set('Audio playback failed');
    });
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private cleanup(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.audioBlob = null;
    this.currentTime.set(0);
    this.duration.set(0);
  }
}
