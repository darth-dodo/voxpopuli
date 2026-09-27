/** Sample rate of OpenAI `pcm16` audio output (24 kHz, mono, 16-bit little-endian). */
export const PCM16_SAMPLE_RATE = 24_000;

const WAV_HEADER_BYTES = 44;

/**
 * Wrap raw 16-bit little-endian PCM samples in a RIFF/WAVE header so
 * browsers can play the result directly as `audio/wav`.
 *
 * @param pcm        - Raw PCM16 sample bytes
 * @param sampleRate - Samples per second (default 24 kHz)
 * @param channels   - Channel count (default mono)
 * @returns A complete WAV file buffer
 */
export function pcm16ToWav(pcm: Buffer, sampleRate = PCM16_SAMPLE_RATE, channels = 1): Buffer {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
