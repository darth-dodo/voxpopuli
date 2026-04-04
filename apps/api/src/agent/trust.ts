import type { TrustMetadata, AgentStep, AgentSource } from '@voxpopuli/shared-types';

/** Patterns in the answer that indicate contrasting viewpoints. */
const CONTRASTING_PHRASES = [
  'however',
  'on the other hand',
  'disagree',
  'contrary',
  'conversely',
  'in contrast',
  'despite this',
  'opponents argue',
  'critics say',
  'some argue',
] as const;

/** Patterns that indicate the agent could not find relevant results. */
const NO_RESULTS_PHRASES = [
  "couldn't find",
  'no relevant',
  'no results',
  'nothing found',
  'could not find',
  'unable to find',
] as const;

/** Milliseconds in one day. */
const MS_PER_DAY = 86_400_000;

/** Days threshold for "old sources" honesty flag (2 years). */
const OLD_SOURCE_THRESHOLD_DAYS = 730;

/** Days in 12 months for recency ratio calculation. */
const RECENT_THRESHOLD_DAYS = 365;

/**
 * Extract story IDs that were fetched by tool calls during the agent run.
 *
 * Looks at `get_story` and `search_hn` action steps and their corresponding
 * observation outputs to determine which story IDs were actually retrieved.
 *
 * @param steps - All agent steps from the run
 * @returns Set of story IDs that were fetched by tools
 */
function getVerifiedStoryIds(steps: AgentStep[]): Set<number> {
  const verified = new Set<number>();

  for (const step of steps) {
    // get_story fetches a specific story by ID
    if (step.type === 'action' && step.toolName === 'get_story') {
      const storyId = step.toolInput?.['story_id'];
      if (typeof storyId === 'number') {
        verified.add(storyId);
      }
    }

    // get_comments fetches comments for a specific story
    if (step.type === 'action' && step.toolName === 'get_comments') {
      const storyId = step.toolInput?.['story_id'];
      if (typeof storyId === 'number') {
        verified.add(storyId);
      }
    }

    // search_hn observations contain story IDs in [12345] format
    if (step.type === 'observation' && step.toolName === 'search_hn' && step.toolOutput) {
      const idPattern = /\[(\d+)\]/g;
      let match;
      while ((match = idPattern.exec(step.toolOutput)) !== null) {
        verified.add(parseInt(match[1], 10));
      }
    }
  }

  return verified;
}

/**
 * Parse "Posted: YYYY-MM-DD" dates from tool observation outputs.
 *
 * The `get_story` tool emits dates in this format. We collect all
 * parseable dates to compute source age metrics.
 *
 * @param steps - All agent steps from the run
 * @returns Array of parsed Date objects
 */
function extractDatesFromSteps(steps: AgentStep[]): Date[] {
  const dates: Date[] = [];
  const datePattern = /Posted:\s*(\d{4}-\d{2}-\d{2})/g;

  for (const step of steps) {
    if (step.type !== 'observation' || !step.toolOutput) continue;

    let match;
    while ((match = datePattern.exec(step.toolOutput)) !== null) {
      const parsed = new Date(match[1]);
      if (!isNaN(parsed.getTime())) {
        dates.push(parsed);
      }
    }
  }

  return dates;
}

/**
 * Count distinct tool calls of a given tool name across action steps.
 *
 * @param steps    - All agent steps from the run
 * @param toolName - The tool name to count
 * @returns Number of distinct action steps for that tool
 */
function countToolCalls(steps: AgentStep[], toolName: string): number {
  return steps.filter((s) => s.type === 'action' && s.toolName === toolName).length;
}

/**
 * Count distinct story IDs targeted by `get_comments` tool calls.
 *
 * @param steps - All agent steps from the run
 * @returns Number of distinct stories whose comments were fetched
 */
function countDistinctCommentStories(steps: AgentStep[]): number {
  const storyIds = new Set<number>();
  for (const step of steps) {
    if (step.type === 'action' && step.toolName === 'get_comments') {
      const storyId = step.toolInput?.['story_id'];
      if (typeof storyId === 'number') {
        storyIds.add(storyId);
      }
    }
  }
  return storyIds.size;
}

/**
 * Determine viewpoint diversity based on agent behavior and answer content.
 *
 * Heuristic:
 * - If the answer contains contrasting phrases → 'contested'
 * - If multiple searches OR comments from 2+ stories → 'balanced'
 * - Otherwise → 'one-sided'
 *
 * @param steps  - All agent steps from the run
 * @param answer - The final agent answer text
 * @returns Viewpoint diversity classification
 */
function classifyViewpointDiversity(
  steps: AgentStep[],
  answer: string,
): TrustMetadata['viewpointDiversity'] {
  const lowerAnswer = answer.toLowerCase();

  // Check for contrasting language in the answer
  const hasContrast = CONTRASTING_PHRASES.some((phrase) => lowerAnswer.includes(phrase));
  if (hasContrast) {
    return 'contested';
  }

  // Check for breadth of research
  const searchCount = countToolCalls(steps, 'search_hn');
  const commentStoryCount = countDistinctCommentStories(steps);

  if (searchCount > 1 || commentStoryCount >= 2) {
    return 'balanced';
  }

  return 'one-sided';
}

/**
 * Compute trust metadata from the agent run results.
 *
 * Analyzes agent steps, extracted sources, and the final answer to produce
 * trust signals including source verification, recency, viewpoint diversity,
 * Show HN detection, and honesty flags.
 *
 * @param steps   - All agent steps from the run
 * @param sources - Extracted sources from tool outputs
 * @param answer  - The final agent answer text
 * @returns Computed {@link TrustMetadata}
 */
export function computeTrustMetadata(
  steps: AgentStep[],
  sources: AgentSource[],
  answer: string,
): TrustMetadata {
  // 1. Source verification
  const verifiedIds = getVerifiedStoryIds(steps);
  const sourcesVerified = sources.filter((s) => verifiedIds.has(s.storyId)).length;
  const sourcesTotal = sources.length;

  // 2. Recency scoring
  const dates = extractDatesFromSteps(steps);
  const now = Date.now();

  let avgSourceAge = 0;
  let recentSourceRatio = 0;

  if (dates.length > 0) {
    const ageDays = dates.map((d) => Math.max(0, Math.floor((now - d.getTime()) / MS_PER_DAY)));
    avgSourceAge = Math.round(ageDays.reduce((sum, age) => sum + age, 0) / ageDays.length);
    const recentCount = ageDays.filter((age) => age <= RECENT_THRESHOLD_DAYS).length;
    recentSourceRatio = Math.round((recentCount / dates.length) * 100) / 100;
  }

  // 3. Viewpoint diversity
  const viewpointDiversity = classifyViewpointDiversity(steps, answer);

  // 4. Show HN detection
  const showHnCount = sources.filter((s) => s.title.startsWith('Show HN:')).length;

  // 5. Honesty flags
  const honestyFlags: string[] = [];

  const lowerAnswer = answer.toLowerCase();
  const hasNoResults = NO_RESULTS_PHRASES.some((phrase) => lowerAnswer.includes(phrase));
  if (hasNoResults) {
    honestyFlags.push('no_results_found');
  }

  if (dates.length > 0) {
    const allOld = dates.every((d) => (now - d.getTime()) / MS_PER_DAY > OLD_SOURCE_THRESHOLD_DAYS);
    if (allOld) {
      honestyFlags.push('old_sources_noted');
    }
  }

  return {
    sourcesVerified,
    sourcesTotal,
    avgSourceAge,
    recentSourceRatio,
    viewpointDiversity,
    showHnCount,
    honestyFlags,
  };
}
