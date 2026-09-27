import { describe, it, expect } from 'vitest';
import { percentile, pctChange, summarizeLatency } from '../latency-stats';
import type { EvalScore } from '../types';

function score(durationMs: number, extra: Partial<EvalScore> = {}): EvalScore {
  return {
    queryId: 'q',
    sourceAccuracy: 1,
    qualityChecklist: 1,
    efficiency: 1,
    latency: 1,
    cost: 1,
    weighted: 1,
    durationMs,
    details: {},
    ...extra,
  };
}

describe('percentile', () => {
  it('uses nearest-rank on an unsorted sample', () => {
    expect(percentile([30, 10, 20, 40], 50)).toBe(20);
    expect(percentile([30, 10, 20, 40], 95)).toBe(40);
  });

  it('returns 0 for an empty sample', () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe('pctChange', () => {
  it('is negative when latency drops', () => {
    expect(pctChange(100, 25)).toBe(-75);
  });

  it('guards against a zero baseline', () => {
    expect(pctChange(0, 10)).toBe(0);
  });
});

describe('summarizeLatency', () => {
  it('excludes errored runs so fast failures do not look like fast answers', () => {
    const summary = summarizeLatency([
      score(10_000),
      score(20_000),
      score(5, { details: { error: 'HTTP 500' } }),
    ]);
    expect(summary.samples).toBe(2);
    expect(summary.meanMs).toBe(15_000);
  });

  it('averages per-stage timings and counts fallbacks', () => {
    const summary = summarizeLatency([
      score(30_000, {
        timings: { firstEventMs: 5, stages: { retriever: 10_000, writer: 8_000 }, fallback: false },
      }),
      score(90_000, {
        timings: { firstEventMs: 5, stages: { retriever: 20_000 }, fallback: true },
      }),
    ]);
    expect(summary.stageMeanMs.retriever).toBe(15_000);
    expect(summary.stageMeanMs.writer).toBe(8_000);
    expect(summary.stageMeanMs.synthesizer).toBeUndefined();
    expect(summary.fallbacks).toBe(1);
  });

  it('handles reports without any raw durations', () => {
    const legacy = score(0);
    delete legacy.durationMs;
    expect(summarizeLatency([legacy]).samples).toBe(0);
  });
});
