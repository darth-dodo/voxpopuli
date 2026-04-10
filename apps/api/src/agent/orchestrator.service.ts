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
import { computeTrustMetadata } from './trust';
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
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const collectedSteps: AgentStep[] = [];

    // The active provider is whatever was passed per-request (all stages use same provider by default)
    const activeProvider =
      config.providerMap.retriever ??
      config.providerMap.synthesizer ??
      config.providerMap.writer ??
      this.llm.getProviderName();

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
      bundle: undefined,
      analysis: undefined,
      response: undefined,
    };

    // Stream events from the graph
    const eventStream = graph.streamEvents(initialState, { version: 'v2' });

    let finalResponse: AgentResponseV2 | undefined;

    for await (const event of eventStream) {
      // Pipeline stage events (dispatched via dispatchCustomEvent from nodes)
      if (event.event === 'on_custom_event' && event.name === 'pipeline_event') {
        yield { kind: 'pipeline', event: event.data as PipelineEvent };
      }

      // Retriever inner steps — tool calls and observations
      if (event.event === 'on_tool_start') {
        const step: AgentStep = {
          type: 'action' as const,
          content: `Calling ${event.name}`,
          toolName: event.name,
          toolInput: event.data?.input,
          timestamp: Date.now(),
        };
        collectedSteps.push(step);
        yield { kind: 'step', step };
      }

      if (event.event === 'on_tool_end') {
        const output = event.data?.output;
        const step: AgentStep = {
          type: 'observation' as const,
          content: typeof output === 'string' ? output : JSON.stringify(output),
          toolName: event.name,
          toolOutput: typeof output === 'string' ? output : JSON.stringify(output),
          timestamp: Date.now(),
        };
        collectedSteps.push(step);
        yield { kind: 'step', step };
      }

      // Track token usage from LLM calls
      if (event.event === 'on_chat_model_end') {
        const usage = event.data?.output?.usage_metadata;
        if (usage) {
          if (usage.input_tokens) totalInputTokens += usage.input_tokens;
          if (usage.output_tokens) totalOutputTokens += usage.output_tokens;
        }
      }

      // Capture final response via the dedicated custom event from the Writer node.
      if (event.event === 'on_custom_event' && event.name === 'pipeline_response') {
        finalResponse = event.data as AgentResponseV2;
      }
    }

    // After all events, emit the complete response
    if (finalResponse) {
      yield {
        kind: 'complete',
        response: {
          answer: `## ${finalResponse.headline}\n\n${
            finalResponse.context
          }\n\n${finalResponse.sections
            .map((s) => `### ${s.heading}\n\n${s.body}`)
            .join('\n\n')}\n\n**Bottom line:** ${finalResponse.bottomLine}`,
          steps: collectedSteps,
          sources: finalResponse.sources.map((s) => ({
            storyId: s.storyId,
            title: s.title,
            url: s.url ?? '',
            author: s.author,
            points: s.points,
            commentCount: s.commentCount,
          })),
          meta: {
            provider: activeProvider,
            totalInputTokens,
            totalOutputTokens,
            durationMs: Date.now() - startTime,
            cached: false,
          },
          trust: computeTrustMetadata(
            collectedSteps,
            finalResponse.sources.map((s) => ({
              storyId: s.storyId,
              title: s.title,
              url: s.url ?? '',
              author: s.author,
              points: s.points,
              commentCount: s.commentCount,
            })),
            finalResponse.headline + ' ' + finalResponse.sections.map((s) => s.body).join(' '),
          ),
        },
      };
    }
  }
}
