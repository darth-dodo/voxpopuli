import { addXingHeader } from './mp3-xing';

/** MPEG-2 Layer III bitrates (kbps) by index, as Voxtral emits (22.05 kHz mono). */
const MPEG2_L3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** Build one MPEG-2 Layer III, 22.05 kHz, mono frame with a zeroed payload. */
function frame(bitrateIndex: number): Buffer {
  const size = Math.floor((72 * MPEG2_L3_KBPS[bitrateIndex] * 1000) / 22050);
  const buf = Buffer.alloc(size);
  // sync + MPEG-2 + Layer III + no CRC | bitrate | 22.05 kHz, no padding | mono
  buf.set([0xff, 0xf3, (bitrateIndex << 4) | 0x00, 0xc0]);
  return buf;
}

/** A variable-bitrate stream with no Xing/Info header, like Voxtral's output. */
function vbrStream(bitrateIndexes: number[]): Buffer {
  return Buffer.concat(bitrateIndexes.map(frame));
}

/** ID3v2.4 tag with a synchsafe size and `payloadSize` zero bytes. */
function id3(payloadSize: number): Buffer {
  const header = Buffer.from([
    0x49,
    0x44,
    0x33,
    4,
    0,
    0,
    (payloadSize >> 21) & 0x7f,
    (payloadSize >> 14) & 0x7f,
    (payloadSize >> 7) & 0x7f,
    payloadSize & 0x7f,
  ]);
  return Buffer.concat([header, Buffer.alloc(payloadSize)]);
}

const VBR_PATTERN = [5, 8, 3, 10, 6, 1, 12, 7, 4, 9, 2, 11];

describe('addXingHeader', () => {
  it('inserts a Xing frame with the exact frame and byte counts', () => {
    const audio = vbrStream(VBR_PATTERN);
    const out = addXingHeader(audio);

    const tagAt = out.indexOf('Xing');
    expect(tagAt).toBeGreaterThan(0);
    expect(tagAt).toBeLessThan(64); // inside the first (inserted) frame
    const flags = out.readUInt32BE(tagAt + 4);
    expect(flags & 0x03).toBe(0x03); // frames + bytes fields present
    expect(out.readUInt32BE(tagAt + 8)).toBe(VBR_PATTERN.length);
    expect(out.readUInt32BE(tagAt + 12)).toBe(out.length); // whole stream incl. Xing frame
  });

  it('keeps every original audio frame intact after the Xing frame', () => {
    const audio = vbrStream(VBR_PATTERN);
    const out = addXingHeader(audio);

    expect(out.subarray(out.length - audio.length)).toEqual(audio);
  });

  it('writes a valid MPEG-2 Layer III mono frame header for the Xing frame', () => {
    const out = addXingHeader(vbrStream(VBR_PATTERN));

    expect(out[0]).toBe(0xff);
    expect(out[1] & 0xfe).toBe(0xf2); // MPEG-2, Layer III
    expect(out[3] >> 6).toBe(3); // mono, matching the audio
  });

  it('includes a 100-entry seek table that increases monotonically', () => {
    const out = addXingHeader(vbrStream([...VBR_PATTERN, ...VBR_PATTERN, ...VBR_PATTERN]));
    const tagAt = out.indexOf('Xing');
    const toc = [...out.subarray(tagAt + 16, tagAt + 116)];

    expect(toc).toHaveLength(100);
    expect(toc[0]).toBe(0);
    toc.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(toc[i]));
  });

  it('preserves a leading ID3v2 tag', () => {
    const tag = id3(30);
    const out = addXingHeader(Buffer.concat([tag, vbrStream(VBR_PATTERN)]));

    expect(out.subarray(0, tag.length)).toEqual(tag);
    expect(out.indexOf('Xing')).toBeGreaterThan(tag.length);
    expect(out.readUInt32BE(out.indexOf('Xing') + 12)).toBe(out.length - tag.length);
  });

  it('returns the input unchanged when it already has a Xing or Info header', () => {
    const once = addXingHeader(vbrStream(VBR_PATTERN));

    expect(addXingHeader(once)).toBe(once);
  });

  it('returns the input unchanged when it is not a parseable MP3', () => {
    const garbage = Buffer.from('definitely not an mp3 file');

    expect(addXingHeader(garbage)).toBe(garbage);
    expect(addXingHeader(Buffer.alloc(0)).length).toBe(0);
  });
});
