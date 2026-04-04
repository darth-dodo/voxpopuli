import type { AgentResponse, AgentStep, AgentSource } from '@voxpopuli/shared-types';

/**
 * Build a partial AgentResponse from data collected before an LLM failure.
 *
 * If at least one step completed with tool results, returns a partial response
 * summarizing what was found. If no steps completed, returns null (indicating
 * the caller should throw a clean error instead).
 *
 * @param steps     - Steps completed before the error
 * @param sources   - Sources extracted before the error
 * @param provider  - Active LLM provider name
 * @param startTime - Timestamp when the run started
 * @param error     - The error that occurred
 * @returns Partial AgentResponse or null if no useful data was collected
 */
export function buildPartialResponse(
  steps: AgentStep[],
  sources: AgentSource[],
  provider: string,
  startTime: number,
  error: Error,
): AgentResponse | null {
  const observations = steps.filter((s) => s.type === 'observation');

  // If no tool results were collected, there's nothing useful to return
  if (observations.length === 0) {
    return null;
  }

  const isTimeout = error.name === 'AbortError' || error.name === 'TimeoutError';
  const errorReason = isTimeout ? 'timed out' : error.message || 'an unknown error';

  // Summarize what was found in observations
  const summaryParts = observations
    .map((obs) => {
      const preview = obs.toolOutput
        ? obs.toolOutput.slice(0, 200) + (obs.toolOutput.length > 200 ? '...' : '')
        : obs.content.slice(0, 200);
      return `[${obs.toolName ?? 'unknown'}] ${preview}`;
    })
    .join('\n\n');

  const answer = [
    `The agent encountered an error after ${steps.length} steps (${errorReason}).`,
    `Here's what was found so far:`,
    '',
    summaryParts,
  ].join('\n');

  return {
    answer,
    steps,
    sources,
    trust: {
      sourcesVerified: 0,
      sourcesTotal: sources.length,
      avgSourceAge: 0,
      recentSourceRatio: 0,
      viewpointDiversity: 'one-sided',
      showHnCount: 0,
      honestyFlags: ['agent_error_partial_results'],
    },
    meta: {
      provider,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      durationMs: Date.now() - startTime,
      cached: false,
      error: true,
    },
  };
}
