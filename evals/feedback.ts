import type { EvalQuery, EvalScore } from './types';

const LANGSMITH_PROJECT = process.env.LANGSMITH_PROJECT || 'voxpopuli-evals';

/**
 * Post eval scores to LangSmith as feedback on the most recent matching run.
 *
 * Finds the latest run in the project whose input contains the query text,
 * then attaches each evaluator score as feedback. This keeps CLI scores
 * and LangSmith dashboard numbers in sync.
 *
 * Fails silently — LangSmith feedback is best-effort.
 */
export async function postScoresToLangSmith(
  score: EvalScore,
  query: EvalQuery,
  provider: string,
): Promise<void> {
  if (!process.env.LANGSMITH_API_KEY) return;

  try {
    const { Client } = await import('langsmith');
    const client = new Client();

    // Find the most recent run matching this query in our project
    const runs = client.listRuns({
      projectName: LANGSMITH_PROJECT,
      filter: `eq(is_root, true)`,
      limit: 10,
    });

    let matchedRunId: string | undefined;
    for await (const run of runs) {
      // Match by query text in inputs
      const inputQuery =
        (run.inputs as Record<string, unknown>)?.query ??
        (run.inputs as Record<string, unknown>)?.input;
      if (typeof inputQuery === 'string' && inputQuery.includes(query.query.substring(0, 50))) {
        matchedRunId = run.id;
        break;
      }
    }

    if (!matchedRunId) return;

    // Post each score dimension as feedback
    const feedbackEntries: [string, number][] = [
      ['source_accuracy', score.sourceAccuracy],
      ['quality_checklist', score.qualityChecklist],
      ['efficiency', score.efficiency],
      ['latency', score.latency],
      ['cost', score.cost],
      ['weighted_total', score.weighted],
    ];

    await Promise.allSettled(
      feedbackEntries.map(([key, value]) =>
        client.createFeedback(matchedRunId, key, {
          score: value,
          comment: `eval:${score.queryId} provider:${provider}`,
        }),
      ),
    );
  } catch {
    // Non-fatal — feedback is best-effort
  }
}
