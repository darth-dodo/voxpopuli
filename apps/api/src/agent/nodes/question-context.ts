/**
 * The question a pipeline stage must answer. `priorQuery` is set for follow-ups
 * (`?followUpOf=<queryId>`): the evidence was gathered for `priorQuery`, and
 * `query` is the new question to answer from it.
 */
export interface QuestionContext {
  query: string;
  priorQuery?: string;
}

/**
 * Render the question header placed at the top of the Synthesizer and Writer inputs.
 *
 * For a follow-up, the new question is labelled as the one to answer and the earlier
 * question is labelled as context only, with an explicit instruction not to restate
 * the earlier answer — otherwise the reused evidence (gathered for the earlier
 * question) pulls the answer back to the original headline.
 */
export function formatQuestionContext({ query, priorQuery }: QuestionContext): string {
  if (!priorQuery) return `Question: "${query}"`;
  return [
    `Follow-up question (answer THIS): "${query}"`,
    `Earlier question (context only, already answered): "${priorQuery}"`,
    '',
    `This is a follow-up to "${priorQuery}". The evidence below was gathered for the earlier ` +
      'question. Answer the follow-up question specifically, using only the parts of the ' +
      'evidence that bear on it. Do not restate the earlier answer. The headline must ' +
      'address the follow-up question, not the earlier one.',
  ].join('\n');
}
