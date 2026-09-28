import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { AudioPlayerComponent } from './audio-player.component';
import { TtsService } from '../../services/tts.service';

describe('AudioPlayerComponent', () => {
  let component: AudioPlayerComponent;
  let fixture: ComponentFixture<AudioPlayerComponent>;
  let mockTtsService: { narrate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockTtsService = {
      narrate: vi.fn().mockReturnValue(
        of({
          blob: new Blob(['fake-audio'], { type: 'audio/mpeg' }),
          characterCount: 100,
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [AudioPlayerComponent],
      providers: [{ provide: TtsService, useValue: mockTtsService }],
    }).compileComponents();

    fixture = TestBed.createComponent(AudioPlayerComponent);
    component = fixture.componentInstance;

    // Set required inputs
    fixture.componentRef.setInput('text', 'Test answer text');
    fixture.componentRef.setInput('disabled', false);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start in idle state', () => {
    expect(component.state()).toBe('idle');
  });

  it('should transition to loading on listen click', () => {
    component.onListen();
    expect(component.state()).toBe('loading');
    expect(mockTtsService.narrate).toHaveBeenCalledWith('Test answer text', true);
  });

  it('should not start when disabled', () => {
    fixture.componentRef.setInput('disabled', true);
    component.onListen();
    expect(component.state()).toBe('idle');
    expect(mockTtsService.narrate).not.toHaveBeenCalled();
  });

  it('should transition to error on service failure', () => {
    mockTtsService.narrate.mockReturnValue(throwError(() => new Error('API down')));
    component.onListen();
    expect(component.state()).toBe('error');
    expect(component.errorMessage()).toBe('API down');
  });

  it('should allow retry from error state', () => {
    mockTtsService.narrate.mockReturnValueOnce(throwError(() => new Error('fail')));
    component.onListen();
    expect(component.state()).toBe('error');

    // Reset mock for retry
    mockTtsService.narrate.mockReturnValue(
      of({ blob: new Blob(['audio'], { type: 'audio/mpeg' }), characterCount: 50 }),
    );
    component.onRetry();
    expect(component.state()).toBe('loading');
  });

  it('should cancel loading and return to idle', () => {
    component.onListen();
    expect(component.state()).toBe('loading');
    component.cancelLoading();
    expect(component.state()).toBe('idle');
  });

  it('should show loading elapsed and phase text', () => {
    expect(component.loadingElapsed()).toBe(0);
    expect(component.loadingPhase()).toBe('Rewriting for speech');
  });

  it('should cycle speed on speed button click', () => {
    expect(component.playbackSpeed()).toBe(1);
    component.cycleSpeed();
    expect(component.playbackSpeed()).toBe(1.25);
    component.cycleSpeed();
    expect(component.playbackSpeed()).toBe(1.5);
    component.cycleSpeed();
    expect(component.playbackSpeed()).toBe(0.75);
    component.cycleSpeed();
    expect(component.playbackSpeed()).toBe(1);
  });

  describe('mobile playback', () => {
    /** Minimal stand-in for HTMLAudioElement: events plus spy-able play/pause. */
    class FakeAudio extends EventTarget {
      static instances: FakeAudio[] = [];
      src = '';
      currentTime = 0;
      duration = 60;
      playbackRate = 1;
      play = vi.fn(() => Promise.resolve());
      pause = vi.fn();
      constructor(src?: string) {
        super();
        if (src) this.src = src;
        FakeAudio.instances.push(this);
      }
      removeAttribute(name: string): void {
        if (name === 'src') this.src = '';
      }
      load = vi.fn();
    }

    let narration$: Subject<{ blob: Blob; characterCount: number }>;
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
      FakeAudio.instances = [];
      vi.stubGlobal('Audio', FakeAudio);
      narration$ = new Subject();
      mockTtsService.narrate.mockReturnValue(narration$.asObservable());
    });

    afterEach(() => vi.unstubAllGlobals());

    function deliverAudio(): FakeAudio {
      narration$.next({ blob: new Blob(['mp3'], { type: 'audio/mpeg' }), characterCount: 100 });
      return FakeAudio.instances[0];
    }

    it('unlocks an audio element synchronously inside the Listen tap (iOS gesture rule)', () => {
      component.onListen();

      // Before the narration request resolves, an element already exists and play() ran
      // inside the user gesture, so iOS will allow the later play() of the real audio.
      expect(FakeAudio.instances).toHaveLength(1);
      expect(FakeAudio.instances[0].play).toHaveBeenCalledTimes(1);
    });

    it('plays the narration on the same unlocked element', async () => {
      component.onListen();
      const audio = deliverAudio();
      audio.dispatchEvent(new Event('canplay'));
      await flush();

      expect(FakeAudio.instances).toHaveLength(1);
      expect(audio.src).toMatch(/^blob:/);
      expect(audio.play).toHaveBeenCalledTimes(2); // unlock + real playback
      expect(component.state()).toBe('playing');
    });

    it('does not resume on its own when canplay fires again after the user paused', async () => {
      component.onListen();
      const audio = deliverAudio();
      audio.dispatchEvent(new Event('canplay'));
      await flush();

      component.togglePlayPause();
      expect(component.state()).toBe('paused');

      // Mobile browsers fire canplay again after a seek or a rebuffer.
      audio.dispatchEvent(new Event('canplay'));
      await flush();

      expect(audio.play).toHaveBeenCalledTimes(2);
      expect(component.state()).toBe('paused');
    });

    it('stays paused when the browser refuses play()', async () => {
      component.onListen();
      const audio = deliverAudio();
      audio.dispatchEvent(new Event('canplay'));
      await flush();
      component.togglePlayPause();

      audio.play.mockReturnValueOnce(
        Promise.reject(new DOMException('blocked', 'NotAllowedError')),
      );
      component.togglePlayPause();
      await flush();

      expect(component.state()).toBe('paused');
    });
  });
});
