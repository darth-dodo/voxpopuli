/**
 * Add a Xing VBR header to MP3 audio that lacks one.
 *
 * Voxtral returns variable-bitrate MP3 without a Xing/Info header. Without
 * it, browsers estimate duration from the first frames' bitrate, and the
 * estimate is wrong by 10-20%. WebKit (iOS Safari) trusts the estimate and
 * stops playback early, cutting off the end of the narration; Chromium plays
 * to the end but its reported duration keeps changing. A Xing frame declares
 * the exact frame count, byte count and a seek table, which fixes both
 * (the same header LAME and ffmpeg write for VBR files).
 */

/** Layer III bitrates (kbps) by bitrate index: MPEG-1, and MPEG-2/2.5. */
const KBPS_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const KBPS_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** Sample rates (Hz) by MPEG version id (bits 19-20) and sample-rate index. */
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

/** Bytes of the Xing payload: tag, flags, frames, bytes, 100-entry TOC, quality. */
const XING_PAYLOAD_BYTES = 4 + 4 + 4 + 4 + 100 + 4;
/** Flags: frames (1) | bytes (2) | TOC (4) | quality (8). */
const XING_FLAGS = 0x0f;

interface FrameInfo {
  version: number;
  sampleRateIndex: number;
  mono: boolean;
  size: number;
}

/** Parse a Layer III frame header at `offset`, or return null if there isn't one. */
function parseFrame(buf: Buffer, offset: number): FrameInfo | null {
  if (offset + 4 > buf.length) return null;
  const [b0, b1, b2, b3] = buf.subarray(offset, offset + 4);
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const version = (b1 >> 3) & 0x03;
  const layer = (b1 >> 1) & 0x03;
  const bitrateIndex = b2 >> 4;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15) return null;
  if (sampleRateIndex === 3) return null;

  const mpeg1 = version === 3;
  const kbps = (mpeg1 ? KBPS_MPEG1 : KBPS_MPEG2)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
  const padding = (b2 >> 1) & 0x01;
  const size = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / sampleRate) + padding;
  if (offset + size > buf.length) return null;

  return { version, sampleRateIndex, mono: b3 >> 6 === 3, size };
}

/** Byte length of a leading ID3v2 tag (0 if absent). */
function id3v2Length(buf: Buffer): number {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return 0;
  const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9];
  const footer = buf[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

/** Side-information length, which precedes the Xing tag inside the frame. */
function sideInfoLength(version: number, mono: boolean): number {
  if (version === 3) return mono ? 17 : 32;
  return mono ? 9 : 17;
}

/**
 * Return `mp3` with a Xing header frame inserted before the first audio
 * frame. Returns the input unchanged if it already has a Xing/Info/VBRI
 * header or can't be parsed as Layer III MP3, so it never breaks audio.
 *
 * @param mp3 - MP3 bytes, optionally starting with an ID3v2 tag
 * @returns MP3 bytes with an exact-duration Xing header
 */
export function addXingHeader(mp3: Buffer): Buffer {
  const audioStart = id3v2Length(mp3);
  const first = parseFrame(mp3, audioStart);
  if (!first) return mp3;

  const side = sideInfoLength(first.version, first.mono);
  const firstFrame = mp3.subarray(audioStart, audioStart + first.size);
  const tag = firstFrame.toString('latin1', 4 + side, 8 + side);
  if (tag === 'Xing' || tag === 'Info' || firstFrame.toString('latin1', 36, 40) === 'VBRI') {
    return mp3;
  }

  // Walk the frames to get the exact count and each frame's byte offset.
  const frameOffsets: number[] = [];
  let offset = audioStart;
  for (let frame = parseFrame(mp3, offset); frame; frame = parseFrame(mp3, offset)) {
    frameOffsets.push(offset - audioStart);
    offset += frame.size;
  }
  const audioBytes = offset - audioStart;

  // Smallest bitrate whose frame can hold the header, side info and Xing payload.
  const mpeg1 = first.version === 3;
  const kbpsTable = mpeg1 ? KBPS_MPEG1 : KBPS_MPEG2;
  const sampleRate = SAMPLE_RATES[first.version][first.sampleRateIndex];
  const needed = 4 + side + XING_PAYLOAD_BYTES;
  const bitrateIndex = kbpsTable.findIndex(
    (kbps, i) => i > 0 && Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / sampleRate) >= needed,
  );
  if (bitrateIndex < 1) return mp3;
  const xingSize = Math.floor(((mpeg1 ? 144 : 72) * kbpsTable[bitrateIndex] * 1000) / sampleRate);

  const xing = Buffer.alloc(xingSize);
  // Same version, layer, sample rate and channel mode as the audio; no CRC, no padding.
  xing[0] = 0xff;
  xing[1] = mp3[audioStart + 1] | 0x01;
  xing[2] = (bitrateIndex << 4) | (mp3[audioStart + 2] & 0x0c);
  xing[3] = mp3[audioStart + 3];

  let p = 4 + side;
  xing.write('Xing', p, 'latin1');
  xing.writeUInt32BE(XING_FLAGS, p + 4);
  xing.writeUInt32BE(frameOffsets.length, p + 8);
  xing.writeUInt32BE(xingSize + audioBytes, p + 12);
  p += 16;
  // Seek table: for each percent of playtime, the byte position as a fraction of 256.
  for (let pct = 0; pct < 100; pct++) {
    const frame = Math.floor((pct / 100) * frameOffsets.length);
    xing[p + pct] = Math.min(255, Math.floor((frameOffsets[frame] * 256) / audioBytes));
  }
  // Quality field (4 bytes) stays 0.

  return Buffer.concat([mp3.subarray(0, audioStart), xing, mp3.subarray(audioStart)]);
}
