import { describe, it, expect } from 'vitest';
import { evaluateCost } from '../cost';

describe('evaluateCost', () => {
  it('returns high score for groq with low tokens', () => {
    // 1000 input tokens, 500 output tokens
    // cost = (1000/1e6)*0.59 + (500/1e6)*0.79 = 0.000590 + 0.000395 = 0.000985
    // score = max(0, 1 - 0.000985/0.05) = ~0.9803
    const result = evaluateCost(1000, 500, 'groq');

    expect(result.key).toBe('cost');
    expect(result.score).toBeGreaterThan(0.95);
    expect(result.comment).toBeDefined();
  });

  it('returns low score for claude with high tokens', () => {
    // 80000 input, 5000 output
    // cost = (80000/1e6)*3.00 + (5000/1e6)*15.00 = 0.24 + 0.075 = 0.315
    // score = max(0, 1 - 0.315/0.05) = max(0, 1 - 6.3) = 0.0
    const result = evaluateCost(80000, 5000, 'claude');

    expect(result.key).toBe('cost');
    expect(result.score).toBe(0.0);
  });

  it('returns score 0.0 when cost exactly at $0.05', () => {
    // For groq: need cost = 0.05
    // Use only input tokens: (tokens/1e6)*0.59 = 0.05 → tokens = 84745.76...
    // Use round numbers: input=$0.05 → tokens = 50000/0.59*1e6... let's just use a known provider
    // Simpler: mistral input $2/M, output $6/M
    // cost = (25000/1e6)*2.00 + (0/1e6)*6.00 = 0.05
    // score = max(0, 1 - 0.05/0.05) = 0.0
    const result = evaluateCost(25000, 0, 'mistral');

    expect(result.key).toBe('cost');
    expect(result.score).toBeCloseTo(0.0, 2);
  });

  it('returns score 1.0 when cost is $0', () => {
    const result = evaluateCost(0, 0, 'groq');

    expect(result.key).toBe('cost');
    expect(result.score).toBe(1.0);
  });
});
