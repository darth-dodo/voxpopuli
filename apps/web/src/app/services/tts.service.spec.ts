import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TtsService, TtsResult } from './tts.service';

describe('TtsService', () => {
  let service: TtsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TtsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should narrate text and return a blob', async () => {
    const fakeChunk = new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // Fake MP3 header bytes
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(fakeChunk);
        controller.close();
      },
    });

    const mockResponse = new Response(fakeStream, {
      status: 200,
      headers: { 'X-TTS-Characters': '100' },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const result = await new Promise<TtsResult>((resolve, reject) => {
      service.narrate('Test text').subscribe({
        next: (r) => resolve(r),
        error: reject,
      });
    });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('audio/mpeg');
    expect(result.characterCount).toBe(100);
  });

  it('should throw on non-ok response', async () => {
    const mockResponse = new Response('Rate limit exceeded', {
      status: 429,
      statusText: 'Too Many Requests',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await expect(
      new Promise<TtsResult>((resolve, reject) => {
        service.narrate('Test text').subscribe({
          next: (r) => resolve(r),
          error: reject,
        });
      }),
    ).rejects.toThrow('429');
  });
});
