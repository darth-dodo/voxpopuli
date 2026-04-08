import type { AgentResponse } from '@voxpopuli/shared-types';
import type { EvaluatorResult } from '../types';

const HN_FIREBASE_URL = 'https://hacker-news.firebaseio.com/v0/item';
const TIMEOUT_MS = 5_000;

/**
 * Verify a single HN story ID exists via the Firebase API.
 * Returns true if the API returns non-null JSON within the timeout.
 */
async function verifyStory(storyId: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${HN_FIREBASE_URL}/${storyId}.json`, {
      signal: controller.signal,
    });
    const data = await res.json();
    return data !== null;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Evaluates source accuracy by verifying each AgentSource's storyId
 * against the HN Firebase API.
 *
 * Score = verified / total sources (0 if no sources or null response).
 */
export async function evaluateSourceAccuracy(
  response: AgentResponse | null,
): Promise<EvaluatorResult> {
  if (!response) {
    return { key: 'source_accuracy', score: 0, comment: 'No response' };
  }

  const { sources } = response;

  if (sources.length === 0) {
    return { key: 'source_accuracy', score: 0, comment: 'No sources in response' };
  }

  const results = await Promise.allSettled(
    sources.map((s) => verifyStory(s.storyId)),
  );

  const verified = results.filter(
    (r) => r.status === 'fulfilled' && r.value === true,
  ).length;

  const score = verified / sources.length;

  return {
    key: 'source_accuracy',
    score,
    comment: `${verified}/${sources.length} sources verified`,
  };
}
