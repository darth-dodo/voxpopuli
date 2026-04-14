import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
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
    expect(component.loadingPhase()).toBe('Rewriting for speech...');
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
});
