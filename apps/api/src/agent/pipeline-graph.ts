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
type PipelineNodeFn = (state: PipelineGraphState) => Promise<Partial<PipelineGraphState>>;

/**
 * Builds the linear LangGraph pipeline: retriever → synthesizer → writer.
 * Each node receives the accumulated state and returns partial updates.
 */
export function buildPipelineGraph(nodes: {
  retriever: PipelineNodeFn;
  synthesizer: PipelineNodeFn;
  writer: PipelineNodeFn;
}) {
  return new StateGraph(PipelineAnnotation)
    .addNode('retriever', nodes.retriever)
    .addNode('synthesizer', nodes.synthesizer)
    .addNode('writer', nodes.writer)
    .addEdge(START, 'retriever')
    .addEdge('retriever', 'synthesizer')
    .addEdge('synthesizer', 'writer')
    .addEdge('writer', END)
    .compile();
}
