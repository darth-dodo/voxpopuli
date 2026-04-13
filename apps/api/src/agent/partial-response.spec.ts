import type { AgentStep, AgentSource } from '@voxpopuli/shared-types';
import { buildPartialResponse } from './partial-response';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<AgentStep> & { type: AgentStep['type'] }): AgentStep {
  return {
    content: '',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSources(count = 1): AgentSource[] {
  return Array.from({ length: count }, (_, i) => ({
    storyId: i + 1,
    title: `Story ${i + 1}`,
    url: `https://example.com/${i + 1}`,
    author: 'user',
    points: 100,
    commentCount: 10,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPartialResponse', () => {
  const provider = 'groq';
  const startTime = Date.now() - 5000;

  it('should return null when no observation steps exist', () => {
    const steps: AgentStep[] = [
      makeStep({ type: 'thought', content: 'Thinking...' }),
      makeStep({ type: 'action', content: 'Searching', toolName: 'search_hn' }),
    ];

    const result = buildPartialResponse(
      steps,
      makeSources(),
      provider,
      startTime,
      new Error('fail'),
    );

    expect(result).toBeNull();
  });

  it('should return null when steps array is empty', () => {
    const result = buildPartialResponse([], [], provider, startTime, new Error('fail'));
    expect(result).toBeNull();
  });

  it('should return partial response when observation steps exist', () => {
    const steps: AgentStep[] = [
      makeStep({ type: 'thought', content: 'Thinking...' }),
      makeStep({
        type: 'observation',
        content: 'Found results',
        toolName: 'search_hn',
        toolOutput: 'Result data here',
      }),
    ];

    const result = buildPartialResponse(
      steps,
      makeSources(),
      provider,
      startTime,
      new Error('fail'),
    );

    expect(result).not.toBeNull();
    expect(result!.answer).toContain('2 steps');
    expect(result!.answer).toContain('Result data here');
    expect(result!.steps).toBe(steps);
    expect(result!.sources).toHaveLength(1);
  });

  it('should use toolOutput preview when available', () => {
    const toolOutput = 'Short output';
    const steps: AgentStep[] = [
      makeStep({
        type: 'observation',
        content: 'Fallback content',
        toolName: 'search_hn',
        toolOutput,
      }),
    ];

    const result = buildPartialResponse(steps, [], provider, startTime, new Error('fail'));

    expect(result!.answer).toContain('Short output');
    expect(result!.answer).not.toContain('...');
  });

  it('should truncate toolOutput at 200 chars and append ellipsis', () => {
    const longOutput = 'x'.repeat(250);
    const steps: AgentStep[] = [
      makeStep({
        type: 'observation',
        content: 'Fallback',
        toolName: 'search_hn',
        toolOutput: longOutput,
      }),
    ];

    const result = buildPartialResponse(steps, [], provider, startTime, new Error('fail'));

    expect(result!.answer).toContain('x'.repeat(200) + '...');
    expect(result!.answer).not.toContain('x'.repeat(201));
  });

  it('should fall back to content when toolOutput is missing', () => {
    const steps: AgentStep[] = [
      makeStep({
        type: 'observation',
        content: 'Content-based fallback text',
        toolName: 'search_hn',
      }),
    ];

    const result = buildPartialResponse(steps, [], provider, startTime, new Error('fail'));

    expect(result!.answer).toContain('Content-based fallback text');
  });

  it('should detect AbortError as timeout', () => {
    const steps: AgentStep[] = [
      makeStep({ type: 'observation', content: 'data', toolName: 'search_hn', toolOutput: 'data' }),
    ];
    const err = new Error('aborted');
    err.name = 'AbortError';

    const result = buildPartialResponse(steps, [], provider, startTime, err);

    expect(result!.answer).toContain('timed out');
    expect(result!.answer).not.toContain('aborted');
  });

  it('should detect TimeoutError as timeout', () => {
    const steps: AgentStep[] = [
      makeStep({ type: 'observation', content: 'data', toolName: 'search_hn', toolOutput: 'data' }),
    ];
    const err = new Error('timed out');
    err.name = 'TimeoutError';

    const result = buildPartialResponse(steps, [], provider, startTime, err);

    expect(result!.answer).toContain('timed out');
  });

  it('should use error.message for non-timeout errors', () => {
    const steps: AgentStep[] = [
      makeStep({ type: 'observation', content: 'data', toolName: 'search_hn', toolOutput: 'data' }),
    ];
    const err = new Error('LLM provider crashed');

    const result = buildPartialResponse(steps, [], provider, startTime, err);

    expect(result!.answer).toContain('LLM provider crashed');
    expect(result!.answer).not.toContain('timed out');
  });

  it('should fall back to "an unknown error" when error.message is empty', () => {
    const steps: AgentStep[] = [
      makeStep({ type: 'observation', content: 'data', toolName: 'search_hn', toolOutput: 'data' }),
    ];
    const err = new Error('');

    const result = buildPartialResponse(steps, [], provider, startTime, err);

    expect(result!.answer).toContain('an unknown error');
  });

  it('should use "unknown" as toolName when toolName is missing', () => {
    const steps: AgentStep[] = [
      makeStep({
        type: 'observation',
        content: 'some data',
        toolOutput: 'tool data',
      }),
    ];

    const result = buildPartialResponse(steps, [], provider, startTime, new Error('fail'));

    expect(result!.answer).toContain('[unknown]');
  });

  it('should set correct trust metadata', () => {
    const sources = makeSources(3);
    const steps: AgentStep[] = [
      makeStep({ type: 'observation', content: 'data', toolName: 'search_hn', toolOutput: 'data' }),
    ];

    const result = buildPartialResponse(steps, sources, provider, startTime, new Error('fail'));

    expect(result!.trust).toEqual({
      sourcesVerified: 0,
      sourcesTotal: 3,
      avgSourceAge: 0,
      recentSourceRatio: 0,
      viewpointDiversity: 'one-sided',
      showHnCount: 0,
      honestyFlags: ['agent_error_partial_results'],
    });
  });

  it('should set correct meta with error: true', () => {
    const steps: AgentStep[] = [
      makeStep({ type: 'observation', content: 'data', toolName: 'search_hn', toolOutput: 'data' }),
    ];

    const result = buildPartialResponse(steps, [], provider, startTime, new Error('fail'));

    expect(result!.meta.provider).toBe('groq');
    expect(result!.meta.totalInputTokens).toBe(0);
    expect(result!.meta.totalOutputTokens).toBe(0);
    expect(result!.meta.cached).toBe(false);
    expect(result!.meta.error).toBe(true);
    expect(result!.meta.durationMs).toBeGreaterThanOrEqual(0);
  });
});
