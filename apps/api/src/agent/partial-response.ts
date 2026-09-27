import type { AgentResponse, AgentStep, AgentSource } from '@voxpopuli/shared-types';

/** Max characters of each finding shown in the partial answer. */
const PREVIEW_CHARS = 200;

/** Max number of findings listed in the partial answer. */
const MAX_FINDINGS = 5;

/** Reader-friendly names for agent tools. */
const TOOL_LABELS: Record<string, string> = {
  search_hn: 'HN search',
  get_story: 'Story',
  get_comments: 'Comments',
};

/** Raw text of an observation (full tool output when available). */
function observationText(obs: AgentStep): string {
  return obs.toolOutput ?? obs.content;
}

/**
 * Whether an observation is a tool invocation failure rather than data.
 * LangChain reports failed tool calls as observations like
 * "Error invoking tool 'search_hn' with kwargs {...}".
 */
function isToolError(text: string): boolean {
  return /^Error invoking tool\b/.test(text) || /did not match expected schema/.test(text);
}

/** Collapse whitespace and truncate to PREVIEW_CHARS with an ellipsis. */
function toPreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? flat.slice(0, PREVIEW_CHARS) + '...' : flat;
}

/** Reader-friendly tool name, falling back to the raw tool id. */
function toolLabel(toolName: string | undefined): string {
  return toolName ? TOOL_LABELS[toolName] ?? toolName : 'Unknown tool';
}

/** Plain-language explanation of why the run stopped. */
function describeFailure(error: Error): string {
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return 'The request timed out before the agent could write an answer.';
  }
  if (/^Step limit reached/.test(error.message)) {
    return 'The agent used all of its research steps before it could write an answer.';
  }
  const reason = toPreview(error.message.split('\n')[0] ?? '') || 'an unknown error';
  return `The AI model returned an error (${reason}).`;
}

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

  const successful = observations.filter((obs) => !isToolError(observationText(obs)));
  const failedCount = observations.length - successful.length;

  // Deduplicate identical findings (models often repeat the same call)
  const seen = new Set<string>();
  const findings: string[] = [];
  for (const obs of successful) {
    const preview = toPreview(observationText(obs));
    const key = `${obs.toolName}:${preview}`;
    if (!preview || seen.has(key)) continue;
    seen.add(key);
    findings.push(`- **${toolLabel(obs.toolName)}:** ${preview}`);
    if (findings.length >= MAX_FINDINGS) break;
  }

  const lines = [`**This answer couldn't be completed.** ${describeFailure(error)}`];
  if (failedCount > 0) {
    lines.push(
      '',
      failedCount === observations.length
        ? 'Every Hacker News lookup failed because the model sent malformed tool requests, so no results were collected.'
        : `${failedCount} of ${observations.length} Hacker News lookups failed because the model sent malformed tool requests.`,
    );
  }
  if (findings.length > 0) {
    lines.push('', '**What was found before it stopped:**', '', ...findings);
  }
  lines.push(
    '',
    '_Try asking again, rephrasing your question, or switching to a different model._',
  );
  const answer = lines.join('\n');

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
