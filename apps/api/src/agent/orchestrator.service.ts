import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PriorEvidence,
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
import { createAgentTools, type SourceRegistry } from './tools';
import { computeTrustMetadata } from './trust';
import { buildFallbackResponse } from './fallback-response';
import { createRetrieverNode } from './nodes/retriever.node';
import { createMergedSynthesizerNode, createSynthesizerNode } from './nodes/synthesizer.node';
import { createWriterNode } from './nodes/writer.node';
import { renderAnswerMarkdown } from './nodes/writer-draft';
import { buildPipelineGraph, withRetry, withWriterFallback } from './pipeline-graph';
import { isAuthError, LlmAuthError } from '../llm/llm-errors';

/** Output-token cap for the retriever's ReAct turns (see ADR-009). */
const RETRIEVER_REACT_MAX_TOKENS = 768;

// ---------------------------------------------------------------------------
// Stream event types
// ---------------------------------------------------------------------------

/** Union of events yielded by the pipeline. */
export type PipelineStreamEvent =
  | { kind: 'pipeline'; event: PipelineEvent }
  | { kind: 'step'; step: AgentStep }
  | { kind: 'token'; content: string }
  | { kind: 'complete'; response: AgentResponse; evidence?: PriorEvidence };

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
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * Merged mode (`PIPELINE_MERGED_WRITER=true`, off by default): skip the Synthesizer's
   * LLM call and let the Writer analyze the evidence directly. See ADR-010.
   */
  private get mergedWriter(): boolean {
    return this.config?.get<string>('PIPELINE_MERGED_WRITER') === 'true';
  }

  /**
   * Run the pipeline with automatic fallback to legacy agent on failure.
   */
  async *runWithFallback(
    query: string,
    config: PipelineConfig,
    prior?: PriorEvidence,
  ): AsyncGenerator<PipelineStreamEvent | AgentStreamEvent> {
    // Track which stages completed so fallback only marks remaining stages as error
    const completedStages = new Set<string>();

    try {
      for await (const event of this.runStream(query, config, prior)) {
        if (event.kind === 'pipeline' && event.event.status === 'done') {
          completedStages.add(event.event.stage);
        }
        yield event;
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const provider = config.providerMap.retriever ?? this.llm.getProviderName();

      // A rejected API key fails the legacy agent the same way — don't burn a second
      // run on it; tell the operator which key to fix.
      if (isAuthError(error)) {
        this.logger.error(`LLM provider "${provider}" rejected its API key: ${rawMessage}`);
        for (const stage of ['retriever', 'synthesizer', 'writer'] as const) {
          if (!completedStages.has(stage)) {
            yield {
              kind: 'pipeline',
              event: { stage, status: 'error' as const, detail: 'API key rejected', elapsed: 0 },
            } as PipelineStreamEvent;
          }
        }
        throw new LlmAuthError(provider);
      }

      this.logger.warn(`Pipeline failed, falling back to legacy AgentService: ${rawMessage}`);

      // Show a user-friendly message instead of raw API error JSON.
      const detail =
        rawMessage.includes('rate_limit_exceeded') || rawMessage.includes('Request too large')
          ? 'Rate limit reached — retrying with fallback agent...'
          : 'Pipeline error — retrying with fallback agent...';

      // Only mark stages that hadn't completed as error
      for (const stage of ['retriever', 'synthesizer', 'writer'] as const) {
        if (!completedStages.has(stage)) {
          yield {
            kind: 'pipeline',
            event: { stage, status: 'error' as const, detail, elapsed: 0 },
          } as PipelineStreamEvent;
        }
      }

      // Signal that the fallback agent is starting
      yield {
        kind: 'step',
        step: {
          type: 'thought' as const,
          content: `Pipeline unavailable — switching to single-agent mode.`,
          timestamp: Date.now(),
        },
      } as PipelineStreamEvent;

      // Delegate to existing AgentService on the same provider the user chose
      for await (const event of this.agentService.runStream(query, {
        provider: config.providerMap.retriever,
      })) {
        yield event;
      }
    }
  }

  /**
   * Run the pipeline by streaming a LangGraph StateGraph with per-stage event emission.
   */
  async *runStream(
    query: string,
    config: PipelineConfig,
    prior?: PriorEvidence,
  ): AsyncGenerator<PipelineStreamEvent> {
    const startTime = Date.now();

    const activeProvider =
      config.providerMap.retriever ??
      config.providerMap.synthesizer ??
      config.providerMap.writer ??
      this.llm.getProviderName();

    // Compaction, Synthesizer and Writer all reply in JSON: request the provider's
    // JSON mode so the output parses first time (the Retriever's ReAct turns use
    // `reactModel` below, which must stay free-form for tool calls).
    const getModel = (stage: 'retriever' | 'synthesizer' | 'writer') =>
      this.llm.getModel(config.providerMap[stage], { json: true });

    // Tools record every story they surface; the retriever builds the source table from it.
    const sources: SourceRegistry = new Map();
    const tools = createAgentTools(this.hn, this.chunker, sources);
    // ReAct turns only emit tool calls (~350 tokens max observed); the cap bounds the
    // occasional closing monologue the model writes instead of "DONE".
    const reactModel = this.llm.getModel(config.providerMap.retriever, {
      maxTokens: RETRIEVER_REACT_MAX_TOKENS,
    });

    // A follow-up reuses the previous run's evidence: the Retriever stage returns it
    // immediately, and the Synthesizer/Writer answer the new question from it. The
    // earlier question travels as `priorQuery` in graph state so both stages can label
    // the follow-up as the question to answer (see formatQuestionContext).
    const retriever = prior
      ? async () => ({
          bundle: { ...prior.bundle, query },
          steps: prior.steps,
          inputTokens: 0,
          outputTokens: 0,
        })
      : createRetrieverNode(getModel('retriever'), tools, sources, reactModel);

    const graph = buildPipelineGraph({
      retriever,
      synthesizer: this.mergedWriter
        ? createMergedSynthesizerNode()
        : withRetry(createSynthesizerNode(getModel('synthesizer'))),
      writer: withWriterFallback(
        createWriterNode(getModel('writer'), { fromEvidence: this.mergedWriter }),
        () => ({
          response: undefined,
        }),
      ),
    });

    const stageOrder: PipelineStage[] = ['retriever', 'synthesizer', 'writer'];
    let stageIdx = 0;
    let stageStart = Date.now();

    // Accumulated state for building final response
    let bundle: import('@voxpopuli/shared-types').EvidenceBundle | undefined;
    let analysis: import('@voxpopuli/shared-types').AnalysisResult | undefined;
    let writerResponse: AgentResponseV2 | undefined;
    let retrieverSteps: AgentStep[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Emit first stage started
    yield {
      kind: 'pipeline',
      event: {
        stage: 'retriever',
        status: 'started',
        detail: prior
          ? `Reusing ${prior.bundle.allSources.length} sources from "${prior.query}"...`
          : `Searching HN for "${query}"...`,
        elapsed: 0,
      },
    };

    const stream = await graph.stream(
      { query, priorQuery: prior?.query },
      { streamMode: ['updates', 'custom'] as const },
    );

    for await (const chunk of stream) {
      // With multiple streamMode, each chunk is [mode, data]
      const [mode, data] = chunk as [string, unknown];

      // Custom events: real-time step streaming from retriever
      if (mode === 'custom') {
        const customEvent = data as { type: string; data: unknown };
        if (customEvent.type === 'retriever_step') {
          yield { kind: 'step', step: customEvent.data as AgentStep };
        } else if (customEvent.type === 'writer_draft') {
          yield { kind: 'token', content: customEvent.data as string };
        }
        continue;
      }

      // Updates: node completion events
      if (mode === 'updates') {
        const update = data as Record<string, Record<string, unknown>>;
        const nodeName = Object.keys(update)[0] as PipelineStage;
        const nodeOutput = update[nodeName];

        // Accumulate token usage from each node
        totalInputTokens += (nodeOutput.inputTokens as number) ?? 0;
        totalOutputTokens += (nodeOutput.outputTokens as number) ?? 0;

        if (nodeName === 'retriever') {
          bundle = nodeOutput.bundle as typeof bundle;
          retrieverSteps = (nodeOutput.steps as AgentStep[]) ?? [];
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
              detail: this.mergedWriter
                ? `Merged into writer, confidence: ${analysis?.confidence ?? 'unknown'}`
                : `${analysis?.insights.length ?? 0} insights, confidence: ${
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
        // Recorded by the tools from the HN API (parsing it back out of tool text missed
        // stories whose body text contains blank lines).
        postedDate: s.postedDate,
      }));

      yield {
        kind: 'complete',
        response: {
          answer: renderAnswerMarkdown(writerResponse),
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
            retrieverSteps,
            sources,
            writerResponse.headline + ' ' + writerResponse.sections.map((s) => s.body).join(' '),
          ),
        },
        evidence: bundle
          ? { query: prior?.query ?? query, bundle, steps: retrieverSteps }
          : undefined,
      };
    } else if (analysis && bundle) {
      yield {
        kind: 'complete',
        response: buildFallbackResponse(
          analysis,
          bundle,
          {
            provider: activeProvider,
            durationMs: elapsed(),
            totalInputTokens,
            totalOutputTokens,
          },
          retrieverSteps,
        ),
        evidence: { query: prior?.query ?? query, bundle, steps: retrieverSteps },
      };
    }
  }
}
