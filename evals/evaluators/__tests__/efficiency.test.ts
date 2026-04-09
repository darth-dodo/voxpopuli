import { describe, it, expect } from 'vitest';
import { evaluateEfficiency } from '../efficiency';

describe('evaluateEfficiency', () => {
  it('returns score 1.0 when steps equal max', () => {
    const result = evaluateEfficiency(5, 5);

    expect(result.key).toBe('efficiency');
    expect(result.score).toBe(1.0);
  });

  it('returns score 1.0 when steps below max', () => {
    const result = evaluateEfficiency(2, 5);

    expect(result.key).toBe('efficiency');
    expect(result.score).toBe(1.0);
  });

  it('returns score 0.5 when steps at 1.5x max', () => {
    const result = evaluateEfficiency(6, 4);

    expect(result.key).toBe('efficiency');
    expect(result.score).toBeCloseTo(0.5, 2);
  });

  it('returns score 0.0 when steps at 2x max', () => {
    const result = evaluateEfficiency(10, 5);

    expect(result.key).toBe('efficiency');
    expect(result.score).toBe(0.0);
  });

  it('returns score 0.0 when steps above 2x max', () => {
    const result = evaluateEfficiency(15, 5);

    expect(result.key).toBe('efficiency');
    expect(result.score).toBe(0.0);
  });
});
