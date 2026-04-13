import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';

export interface TtsResult {
  blob: Blob;
  characterCount: number;
}

@Injectable({ providedIn: 'root' })
export class TtsService {
  /**
   * POST to /api/tts/narrate with the answer text.
   * Reads chunked MP3 response, collects into a Blob.
   */
  narrate(text: string, rewrite = true): Observable<TtsResult> {
    return from(this.fetchNarration(text, rewrite));
  }

  private async fetchNarration(text: string, rewrite: boolean): Promise<TtsResult> {
    const response = await fetch('/api/tts/narrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, rewrite }),
    });

    if (!response.ok) {
      throw new Error(`TTS request failed: ${response.status} ${response.statusText}`);
    }

    const characterCount = parseInt(response.headers.get('X-TTS-Characters') ?? '0', 10);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const chunks: BlobPart[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value as BlobPart);
    }

    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    return { blob, characterCount };
  }
}
