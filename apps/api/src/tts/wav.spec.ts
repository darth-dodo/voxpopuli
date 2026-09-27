import { pcm16ToWav, PCM16_SAMPLE_RATE } from './wav';

describe('pcm16ToWav', () => {
  const pcm = Buffer.from([0x01, 0x00, 0xff, 0x7f]);
  const wav = pcm16ToWav(pcm);

  it('should prepend a 44-byte RIFF/WAVE header', () => {
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.subarray(8, 16).toString('ascii')).toBe('WAVEfmt ');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it('should describe 24 kHz mono 16-bit PCM by default', () => {
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(PCM16_SAMPLE_RATE);
    expect(wav.readUInt32LE(28)).toBe(PCM16_SAMPLE_RATE * 2); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
  });
});
