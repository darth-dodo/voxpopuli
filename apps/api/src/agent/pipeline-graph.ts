import { Logger } from '@nestjs/common';
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import type {
  EvidenceBundle,
  AnalysisResult,
  AgentResponseV2,
  AgentStep,
} from '@voxpopuli/shared-types';

export const PipelineAnnotation = Annotation.Root({
  query: Annotation<string>,
  /** Set on follow-ups: the earlier question the reused evidence was gathered for. */
  priorQuery: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_prev, next) => next,
  }),
  bundle: Annotation<EvidenceBundle | undefined>({
    default: () => undefined,
    reducer: (_prev, next) => next,
  }),
  analysis: Annotation<AnalysisResult | undefined>({
    default: () => undefined,
    reducer: (_prev, next) => next,
  }),
  response: Annotation<AgentResponseV2 | undefined>({
    default: () => undefined,
    reducer: (_prev, next) => next,
  }),
  steps: Annotation<AgentStep[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),
  inputTokens: Annotation<number>({
    default: () => 0,
    reducer: (prev, next) => prev + next,
  }),
  outputTokens: Annotation<number>({
    default: () => 0,
    reducer: (prev, next) => prev + next,
  }),
});

export type PipelineGraphState = typeof PipelineAnnotation.State;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNodeFn = (state: any, config?: any) => Promise<Record<string, unknown>>;

export type PipelineNodeFn = (state: PipelineGraphState) => Promise<Partial<PipelineGraphState>>;

export function buildPipelineGraph(nodes: {
  retriever: AnyNodeFn;
  synthesizer: AnyNodeFn;
  writer: AnyNodeFn;
}) {
  return new StateGraph(PipelineAnnotation)
    .addNode('retriever', nodes.retriever as PipelineNodeFn)
    .addNode('synthesizer', nodes.synthesizer as PipelineNodeFn)
    .addNode('writer', nodes.writer as PipelineNodeFn)
    .addEdge(START, 'retriever')
    .addEdge('retriever', 'synthesizer')
    .addEdge('synthesizer', 'writer')
    .addEdge('writer', END)
    .compile();
}

const logger = new Logger('PipelineGraph');

/** First line of an error, for logs (LangChain errors can embed whole prompts). */
const firstLine = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 300);

/** True once the run's abort signal (pipeline timeout or client disconnect) fired. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isAborted = (config: any): boolean => Boolean(config?.signal?.aborted);

export function withRetry(fn: AnyNodeFn): AnyNodeFn {
  return async (state, config) => {
    try {
      return await fn(state, config);
    } catch (err) {
      if (isAborted(config)) throw err;
      logger.warn(`Node failed, retrying once: ${firstLine(err)}`);
      return await fn(state, config);
    }
  };
}

export function withWriterFallback(
  fn: AnyNodeFn,
  fallback: (state: PipelineGraphState) => Partial<PipelineGraphState>,
): AnyNodeFn {
  return async (state, config) => {
    try {
      return await fn(state, config);
    } catch (err) {
      if (isAborted(config)) throw err;
      logger.warn(`Writer failed, retrying once: ${firstLine(err)}`);
      // Retry without the graph's stream writer: the first attempt may already have
      // streamed a draft, and re-streaming would append a second copy to the UI.
      // Keep the abort signal so the pipeline timeout still cancels the retry.
      try {
        return await (config?.signal ? fn(state, { signal: config.signal }) : fn(state));
      } catch (retryErr) {
        if (isAborted(config)) throw retryErr;
        logger.warn(`Writer retry failed, using fallback response: ${firstLine(retryErr)}`);
        return fallback(state);
      }
    }
  };
}
