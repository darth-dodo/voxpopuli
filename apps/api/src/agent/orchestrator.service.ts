import { Injectable, Logger } from '@nestjs/common';
import type {
  PipelineConfig,
  PipelineEvent,
  AgentResponseV2,
  AgentStep,
  AgentResponse,
  PipelineStage,
} from '@voxpopuli/shared-types';
import { AgentService, type AgentStreamEvent } from './agent.service';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import { createAgentTools } from './tools';
import { computeTrustMetadata } from './trust';
import { buildFallbackResponse } from './fallback-response';
import { createRetrieverNode } from './nodes/retriever.node';
import { createSynthesizerNode } from './nodes/synthesizer.node';
import { createWriterNode } from './nodes/writer.node';
import { buildPipelineGraph, withRetry, withWriterFallback } from './pipeline-graph';

// ---------------------------------------------------------------------------
// Stream event types
// ---------------------------------------------------------------------------

/** Union of events yielded by the pipeline. */
export type PipelineStreamEvent =
  | { kind: 'pipeline'; event: PipelineEvent }
  | { kind: 'step'; step: AgentStep }
  | { kind: 'token'; content: string }
  | { kind: 'complete'; response: AgentResponse };

/**
 * Orchestrates the multi-agent pipeline via a LangGraph StateGraph.
 *
 * Pipeline: Retriever → Synthesizer → Writer
 *
 * Recovery matrix:
 * - Retriever fails → bubbles to runWithFallback → legacy AgentService
 * - Synthesizer fails → retry once (via withRetry wrapper), then bubble → legacy
 * - Writer fails → retry once then fallback (via withWriterFallback), does NOT bubble
 *
 * Key invariant: the Retriever is never re-run on a downstream failure.
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
   * Run the pipeline by streaming a LangGraph StateGraph with per-stage event emission.
   */
  async *runStream(query: string, config: PipelineConfig): AsyncGenerator<PipelineStreamEvent> {
    const startTime = Date.now();

    const activeProvider =
      config.providerMap.retriever ??
      config.providerMap.synthesizer ??
      config.providerMap.writer ??
      this.llm.getProviderName();

    const getModel = (stage: 'retriever' | 'synthesizer' | 'writer') =>
      this.llm.getModel(config.providerMap[stage]);

    const tools = createAgentTools(this.hn, this.chunker);

    const graph = buildPipelineGraph({
      retriever: createRetrieverNode(getModel('retriever'), tools),
      synthesizer: withRetry(createSynthesizerNode(getModel('synthesizer'))),
      writer: withWriterFallback(createWriterNode(getModel('writer')), () => ({
        response: undefined,
      })),
    });

    const stageOrder: PipelineStage[] = ['retriever', 'synthesizer', 'writer'];
    let stageIdx = 0;
    let stageStart = Date.now();

    // Accumulated state for building final response
    let bundle: import('@voxpopuli/shared-types').EvidenceBundle | undefined;
    let analysis: import('@voxpopuli/shared-types').AnalysisResult | undefined;
    let writerResponse: AgentResponseV2 | undefined;

    // Emit first stage started
    yield {
      kind: 'pipeline',
      event: {
        stage: 'retriever',
        status: 'started',
        detail: `Searching HN for "${query}"...`,
        elapsed: 0,
      },
    };

    const stream = await graph.stream({ query }, { streamMode: ['updates', 'custom'] as const });

    for await (const chunk of stream) {
      // With multiple streamMode, each chunk is [mode, data]
      const [mode, data] = chunk as [string, unknown];

      // Custom events: real-time step streaming from retriever
      if (mode === 'custom') {
        const customEvent = data as { type: string; data: unknown };
        if (customEvent.type === 'retriever_step') {
          yield { kind: 'step', step: customEvent.data as AgentStep };
        }
        continue;
      }

      // Updates: node completion events
      if (mode === 'updates') {
        const update = data as Record<string, Record<string, unknown>>;
        const nodeName = Object.keys(update)[0] as PipelineStage;
        const nodeOutput = update[nodeName];

        if (nodeName === 'retriever') {
          bundle = nodeOutput.bundle as typeof bundle;
          yield {
            kind: 'pipeline',
            event: {
              stage: 'retriever',
              status: 'done',
              detail: `${bundle?.themes.length ?? 0} themes from ${
                bundle?.allSources.length ?? 0
              } sources`,
              elapsed: Date.now() - stageStart,
            },
          };
        } else if (nodeName === 'synthesizer') {
          analysis = nodeOutput.analysis as typeof analysis;
          yield {
            kind: 'pipeline',
            event: {
              stage: 'synthesizer',
              status: 'done',
              detail: `${analysis?.insights.length ?? 0} insights, confidence: ${
                analysis?.confidence ?? 'unknown'
              }`,
              elapsed: Date.now() - stageStart,
            },
          };
        } else if (nodeName === 'writer') {
          writerResponse = nodeOutput.response as typeof writerResponse;
          yield {
            kind: 'pipeline',
            event: {
              stage: 'writer',
              status: 'done',
              detail: writerResponse
                ? `${writerResponse.sections.length} sections, ${writerResponse.sources.length} sources`
                : 'Using fallback response from analysis',
              elapsed: Date.now() - stageStart,
            },
          };
        }

        // Emit next stage started
        stageIdx++;
        if (stageIdx < stageOrder.length) {
          stageStart = Date.now();
          const nextStage = stageOrder[stageIdx];
          const detail =
            nextStage === 'synthesizer'
              ? `Analyzing ${bundle?.themes.length ?? 0} themes...`
              : 'Composing headline and sections...';
          yield {
            kind: 'pipeline',
            event: { stage: nextStage, status: 'started', detail, elapsed: 0 },
          };
        }
      }
    }

    // Emit final response
    const elapsed = () => Date.now() - startTime;

    if (writerResponse) {
      const sources = writerResponse.sources.map((s) => ({
        storyId: s.storyId,
        title: s.title,
        url: s.url ?? '',
        author: s.author,
        points: s.points,
        commentCount: s.commentCount,
      }));

      yield {
        kind: 'complete',
        response: {
          answer: `## ${writerResponse.headline}\n\n${
            writerResponse.context
          }\n\n${writerResponse.sections
            .map((s) => `### ${s.heading}\n\n${s.body}`)
            .join('\n\n')}\n\n**Bottom line:** ${writerResponse.bottomLine}`,
          steps: [],
          sources,
          meta: {
            provider: activeProvider,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            durationMs: elapsed(),
            cached: false,
          },
          trust: computeTrustMetadata(
            [],
            sources,
            writerResponse.headline + ' ' + writerResponse.sections.map((s) => s.body).join(' '),
          ),
        },
      };
    } else if (analysis && bundle) {
      yield {
        kind: 'complete',
        response: buildFallbackResponse(analysis, bundle, {
          provider: activeProvider,
          durationMs: elapsed(),
          totalInputTokens: 0,
          totalOutputTokens: 0,
        }),
      };
    }
  }
}
