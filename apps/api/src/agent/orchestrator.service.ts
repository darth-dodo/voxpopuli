import { Injectable, Logger } from '@nestjs/common';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type {
  PipelineConfig,
  PipelineEvent,
  AgentResponseV2,
  AgentStep,
  AgentResponse,
  EvidenceBundle,
  AnalysisResult,
} from '@voxpopuli/shared-types';
import { AgentService, type AgentStreamEvent } from './agent.service';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import { createAgentTools } from './tools';
import { createRetrieverNode } from './nodes/retriever.node';
import { createSynthesizerNode } from './nodes/synthesizer.node';
import { createWriterNode } from './nodes/writer.node';

// ---------------------------------------------------------------------------
// Stream event types
// ---------------------------------------------------------------------------

/** Discriminated union of events yielded by the pipeline. */
export type PipelineStreamEvent =
  | { kind: 'pipeline'; event: PipelineEvent }
  | { kind: 'step'; step: AgentStep }
  | { kind: 'token'; content: string }
  | { kind: 'complete'; response: AgentResponse };

/**
 * Orchestrates the multi-agent pipeline using LangGraph.
 *
 * Pipeline: Retriever → Synthesizer → Writer
 * Fallback: Legacy AgentService on any pipeline failure.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly llm: LlmService,
    private readonly hn: HnService,
    private readonly chunker: ChunkerService,
  ) {}

  /**
   * Run the pipeline with automatic fallback to legacy agent on failure.
   */
  async *runWithFallback(
    query: string,
    config: PipelineConfig,
  ): AsyncGenerator<PipelineStreamEvent | AgentStreamEvent> {
    try {
      yield* this.runStream(query, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Pipeline failed, falling back to legacy AgentService: ${message}`);

      yield {
        kind: 'pipeline',
        event: {
          stage: 'retriever' as const,
          status: 'error' as const,
          detail: message,
          elapsed: 0,
        },
      } as PipelineStreamEvent;

      // Delegate to existing AgentService
      for await (const event of this.agentService.runStream(query)) {
        yield event;
      }
    }
  }

  /**
   * Run the full LangGraph pipeline, streaming events.
   */
  async *runStream(query: string, config: PipelineConfig): AsyncGenerator<PipelineStreamEvent> {
    const startTime = Date.now();

    // Resolve model per stage (fallback to global provider)
    const getModel = (stage: 'retriever' | 'synthesizer' | 'writer') =>
      this.llm.getModel(config.providerMap[stage]);

    const tools = createAgentTools(this.hn, this.chunker);

    // Build node functions
    const retrieverNode = createRetrieverNode(getModel('retriever'), tools);
    const synthesizerNode = createSynthesizerNode(getModel('synthesizer'));
    const writerNode = createWriterNode(getModel('writer'));

    // Build LangGraph StateGraph with typed annotations
    const PipelineStateAnnotation = Annotation.Root({
      query: Annotation<string>,
      bundle: Annotation<EvidenceBundle | undefined>,
      analysis: Annotation<AnalysisResult | undefined>,
      response: Annotation<AgentResponseV2 | undefined>,
      events: Annotation<PipelineEvent[]>({
        reducer: (_existing: PipelineEvent[], update: PipelineEvent[]) => update,
      }),
      error: Annotation<string | undefined>,
    });

    const graph = new StateGraph(PipelineStateAnnotation)
      .addNode('retriever', retrieverNode)
      .addNode('synthesizer', synthesizerNode)
      .addNode('writer', writerNode)
      .addEdge(START, 'retriever')
      .addEdge('retriever', 'synthesizer')
      .addEdge('synthesizer', 'writer')
      .addEdge('writer', END)
      .compile();

    const initialState = {
      query,
      events: [],
      bundle: undefined,
      analysis: undefined,
      response: undefined,
      error: undefined,
    };

    // Stream events from the graph
    const eventStream = graph.streamEvents(initialState, { version: 'v2' });

    let lastPipelineEventCount = 0;

    for await (const event of eventStream) {
      // Retriever inner steps — tool calls and observations
      if (event.event === 'on_tool_start') {
        yield {
          kind: 'step',
          step: {
            type: 'action' as const,
            content: `Calling ${event.name}`,
            toolName: event.name,
            toolInput: event.data?.input,
            timestamp: Date.now(),
          },
        };
      }

      if (event.event === 'on_tool_end') {
        const output = event.data?.output;
        yield {
          kind: 'step',
          step: {
            type: 'observation' as const,
            content: typeof output === 'string' ? output : JSON.stringify(output),
            toolName: event.name,
            toolOutput: typeof output === 'string' ? output : JSON.stringify(output),
            timestamp: Date.now(),
          },
        };
      }

      // Writer token streaming
      if (event.event === 'on_chat_model_stream' && event.metadata?.langgraph_node === 'writer') {
        const chunk = event.data?.chunk;
        if (chunk?.content && typeof chunk.content === 'string') {
          yield { kind: 'token', content: chunk.content };
        }
      }

      // Pipeline events from state updates
      if (event.event === 'on_chain_end' && event.data?.output?.events) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allEvents = event.data.output.events as any[];
        // Emit only new pipeline events
        for (let i = lastPipelineEventCount; i < allEvents.length; i++) {
          yield { kind: 'pipeline', event: allEvents[i] as PipelineEvent };
        }
        lastPipelineEventCount = allEvents.length;

        // If writer is done, emit complete event
        if (event.data.output.response) {
          const v2Response = event.data.output.response as AgentResponseV2;
          yield {
            kind: 'complete',
            response: {
              answer: `## ${v2Response.headline}\n\n${v2Response.context}\n\n${v2Response.sections
                .map((s) => `### ${s.heading}\n\n${s.body}`)
                .join('\n\n')}\n\n**Bottom line:** ${v2Response.bottomLine}`,
              steps: [],
              sources: v2Response.sources.map((s) => ({ ...s, url: s.url ?? '' })),
              meta: {
                provider: this.llm.getProviderName(),
                totalInputTokens: 0,
                totalOutputTokens: 0,
                durationMs: Date.now() - startTime,
                cached: false,
              },
              trust: {
                sourcesVerified: v2Response.sources.length,
                sourcesTotal: v2Response.sources.length,
                avgSourceAge: 0,
                recentSourceRatio: 0,
                viewpointDiversity: 'balanced' as const,
                showHnCount: 0,
                honestyFlags: [],
              },
            },
          };
        }
      }
    }
  }
}
