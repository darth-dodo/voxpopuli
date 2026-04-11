import { Injectable, Logger } from '@nestjs/common';
import type {
  PipelineConfig,
  PipelineEvent,
  AgentResponseV2,
  AgentStep,
  AgentResponse,
  AnalysisResult,
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
 * Orchestrates the multi-agent pipeline with direct sequential node calls.
 *
 * Pipeline: Retriever → Synthesizer → Writer
 *
 * Recovery matrix:
 * - Retriever fails → bubbles to runWithFallback → legacy AgentService
 * - Synthesizer fails → retry once with same EvidenceBundle, then bubble → legacy
 * - Writer fails → retry once with same AnalysisResult, then buildFallbackResponse
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
   * Run the pipeline by calling nodes directly with per-stage error handling.
   */
  async *runStream(query: string, config: PipelineConfig): AsyncGenerator<PipelineStreamEvent> {
    const startTime = Date.now();
    const totalInputTokens = 0;
    const totalOutputTokens = 0;

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
    const retrieverFn = createRetrieverNode(getModel('retriever'), tools);
    const synthesizerFn = createSynthesizerNode(getModel('synthesizer'));
    const writerFn = createWriterNode(getModel('writer'));

    const elapsed = () => Date.now() - startTime;
    let stageStart = Date.now();
    const stageDuration = () => Date.now() - stageStart;

    // ── Stage 1: Retriever ──────────────────────────────────────────
    // Failures bubble to runWithFallback → legacy agent
    stageStart = Date.now();
    yield {
      kind: 'pipeline',
      event: {
        stage: 'retriever',
        status: 'started',
        detail: `Searching HN for "${query}"...`,
        elapsed: 0,
      },
    };

    const collectedSteps: AgentStep[] = [];
    const { bundle } = await retrieverFn({ query }, (step) => {
      collectedSteps.push(step);
    });

    // Emit collected ReAct steps from the retriever
    for (const step of collectedSteps) {
      yield { kind: 'step', step };
    }

    yield {
      kind: 'pipeline',
      event: {
        stage: 'retriever',
        status: 'done',
        detail: `${bundle.themes.length} themes from ${bundle.allSources.length} sources`,
        elapsed: stageDuration(),
      },
    };

    // ── Stage 2: Synthesizer ────────────────────────────────────────
    // Retry once, then bubble to runWithFallback → legacy agent
    stageStart = Date.now();
    yield {
      kind: 'pipeline',
      event: {
        stage: 'synthesizer',
        status: 'started',
        detail: `Analyzing ${bundle.themes.length} themes...`,
        elapsed: 0,
      },
    };

    let analysis: AnalysisResult;
    try {
      ({ analysis } = await synthesizerFn({ query, bundle }));
    } catch (firstError) {
      this.logger.warn(
        `Synthesizer failed, retrying: ${
          firstError instanceof Error ? firstError.message : firstError
        }`,
      );
      yield {
        kind: 'pipeline',
        event: {
          stage: 'synthesizer',
          status: 'error',
          detail: 'Retrying analysis...',
          elapsed: stageDuration(),
        },
      };
      ({ analysis } = await synthesizerFn({ query, bundle }));
    }

    yield {
      kind: 'pipeline',
      event: {
        stage: 'synthesizer',
        status: 'done',
        detail: `${analysis.insights.length} insights, confidence: ${analysis.confidence}`,
        elapsed: stageDuration(),
      },
    };

    // ── Stage 3: Writer ─────────────────────────────────────────────
    // Retry once, then buildFallbackResponse (does NOT bubble)
    stageStart = Date.now();
    yield {
      kind: 'pipeline',
      event: {
        stage: 'writer',
        status: 'started',
        detail: 'Composing headline and sections...',
        elapsed: 0,
      },
    };

    let writerResponse: AgentResponseV2 | undefined;
    try {
      ({ response: writerResponse } = await writerFn({ query, bundle, analysis }));
    } catch (firstError) {
      this.logger.warn(
        `Writer failed, retrying: ${firstError instanceof Error ? firstError.message : firstError}`,
      );
      yield {
        kind: 'pipeline',
        event: {
          stage: 'writer',
          status: 'error',
          detail: 'Retrying composition...',
          elapsed: stageDuration(),
        },
      };
      try {
        ({ response: writerResponse } = await writerFn({ query, bundle, analysis }));
      } catch (retryError) {
        this.logger.warn(
          `Writer retry failed, using fallback: ${
            retryError instanceof Error ? retryError.message : retryError
          }`,
        );
        yield {
          kind: 'pipeline',
          event: {
            stage: 'writer',
            status: 'error',
            detail: 'Using fallback response from analysis',
            elapsed: stageDuration(),
          },
        };
      }
    }

    // ── Emit final response ─────────────────────────────────────────
    if (writerResponse) {
      yield {
        kind: 'pipeline',
        event: {
          stage: 'writer',
          status: 'done',
          detail: `${writerResponse.sections.length} sections, ${writerResponse.sources.length} sources`,
          elapsed: stageDuration(),
        },
      };

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
            totalInputTokens,
            totalOutputTokens,
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
    } else {
      yield {
        kind: 'complete',
        response: buildFallbackResponse(analysis, bundle, {
          provider: activeProvider,
          durationMs: elapsed(),
          totalInputTokens,
          totalOutputTokens,
        }),
      };
    }
  }
}
