import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import type {
  EvidenceBundle,
  AnalysisResult,
  AgentResponseV2,
  AgentStep,
} from '@voxpopuli/shared-types';

export const PipelineAnnotation = Annotation.Root({
  query: Annotation<string>,
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
});

export type PipelineGraphState = typeof PipelineAnnotation.State;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNodeFn = (state: any) => Promise<Record<string, unknown>>;

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

export function withRetry(fn: AnyNodeFn): AnyNodeFn {
  return async (state) => {
    try {
      return await fn(state);
    } catch {
      return await fn(state);
    }
  };
}

export function withWriterFallback(
  fn: AnyNodeFn,
  fallback: (state: PipelineGraphState) => Partial<PipelineGraphState>,
): AnyNodeFn {
  return async (state) => {
    try {
      return await fn(state);
    } catch {
      try {
        return await fn(state);
      } catch {
        return fallback(state);
      }
    }
  };
}
