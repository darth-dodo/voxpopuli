import { describe, it, expect } from 'vitest';
import { evaluateCost } from '../cost';

describe('evaluateCost', () => {
  it('returns high score for openrouter with low tokens', () => {
    // 1000 input tokens, 500 output tokens
    // cost = (1000/1e6)*0.087 + (500/1e6)*0.35 = 0.000087 + 0.000175 = 0.000262
    // score = max(0, 1 - 0.000262/0.05) = ~0.9948
    const result = evaluateCost(1000, 500, 'openrouter');

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
    // claude-haiku-4-5 for round numbers: input $1/M
    // cost = (50000/1e6)*1.00 = 0.05 → score = max(0, 1 - 0.05/0.05) = 0.0
    const result = evaluateCost(50_000, 0, 'claude');

    expect(result.key).toBe('cost');
    expect(result.score).toBeCloseTo(0.0, 2);
  });

  it('prices a typical Mistral Small pipeline query at about a cent', () => {
    // 60k in / 3k out at $0.15 / $0.60 per M = $0.009 + $0.0018 = $0.0108
    const result = evaluateCost(60_000, 3_000, 'mistral');

    expect(result.comment).toContain('$0.0108');
    expect(result.score).toBeCloseTo(0.784, 3);
  });

  it('returns score 1.0 when cost is $0', () => {
    const result = evaluateCost(0, 0, 'openrouter');

    expect(result.key).toBe('cost');
    expect(result.score).toBe(1.0);
  });
});
