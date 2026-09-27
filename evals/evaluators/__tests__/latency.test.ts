import { describe, it, expect } from 'vitest';
import { evaluateLatency } from '../latency';

describe('evaluateLatency', () => {
  it('returns score 1.0 for openrouter at 3000ms', () => {
    const result = evaluateLatency(3000, 'openrouter');

    expect(result.key).toBe('latency');
    expect(result.score).toBe(1.0);
    expect(result.comment).toContain('3.0');
  });

  it('returns score 0.7 for openrouter at 20000ms', () => {
    const result = evaluateLatency(20000, 'openrouter');

    expect(result.key).toBe('latency');
    expect(result.score).toBe(0.7);
  });

  it('returns score 0.0 for openrouter at 65000ms', () => {
    const result = evaluateLatency(65000, 'openrouter');

    expect(result.key).toBe('latency');
    expect(result.score).toBe(0.0);
  });

  it('returns score 1.0 for claude at 10000ms', () => {
    const result = evaluateLatency(10000, 'claude');

    expect(result.key).toBe('latency');
    expect(result.score).toBe(1.0);
  });

  it('returns score 0.5 for unknown provider at 15000ms', () => {
    const result = evaluateLatency(15000, 'unknown');

    expect(result.key).toBe('latency');
    expect(result.score).toBe(0.5);
  });
});
