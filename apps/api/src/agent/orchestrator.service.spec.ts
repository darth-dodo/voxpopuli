import { Test, TestingModule } from '@nestjs/testing';
import { OrchestratorService, type PipelineStreamEvent } from './orchestrator.service';
import { AgentService } from './agent.service';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import type {
  PipelineConfig,
  EvidenceBundle,
  AnalysisResult,
  AgentResponseV2,
  PipelineEvent,
} from '@voxpopuli/shared-types';
import { buildPipelineGraph } from './pipeline-graph';

jest.mock('langchain', () => ({ createAgent: jest.fn() }));
jest.mock('./tools', () => ({ createAgentTools: jest.fn(() => []) }));
jest.mock('../llm/providers/openrouter.provider', () => ({ OpenRouterProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(() => ({ invoke: jest.fn() })),
}));

jest.mock('./pipeline-graph', () => ({
  buildPipelineGraph: jest.fn(),
  withRetry: jest.fn((fn) => fn),
  withWriterFallback: jest.fn((fn, fallback) => async (state: Record<string, unknown>) => {
    try {
      return await fn(state);
    } catch {
      try {
        return await fn(state);
      } catch {
        return fallback(state);
      }
    }
  }),
}));

jest.mock('./nodes/retriever.node', () => ({
  createRetrieverNode: jest.fn(() => jest.fn()),
}));
jest.mock('./nodes/synthesizer.node', () => ({
  createSynthesizerNode: jest.fn(() => jest.fn()),
  createMergedSynthesizerNode: jest.fn(() => jest.fn()),
}));
jest.mock('./nodes/writer.node', () => ({
  createWriterNode: jest.fn(() => jest.fn()),
}));

// Shared test fixtures
const mockBundle: EvidenceBundle = {
  query: 'test query',
  themes: [
    { label: 'T', items: [{ sourceId: 1, text: 'evidence', type: 'evidence', relevance: 0.9 }] },
  ],
  allSources: [{ storyId: 1, title: 'S1', url: '', author: 'a', points: 10, commentCount: 5 }],
  totalSourcesScanned: 3,
  tokenCount: 500,
};

const mockAnalysis: AnalysisResult = {
  summary: 'Test summary',
  insights: [
    { claim: 'Claim 1', reasoning: 'Reason 1', evidenceStrength: 'strong', themeIndices: [0] },
  ],
  contradictions: [],
  confidence: 'high',
  gaps: [],
};

const mockResponseV2: AgentResponseV2 = {
  headline: 'Test headline',
  context: 'Test context',
  sections: [
    { heading: 'S1', body: 'Body 1', citedSources: [1] },
    { heading: 'S2', body: 'Body 2', citedSources: [1] },
  ],
  bottomLine: 'Test bottom line',
  sources: [
    {
      storyId: 1,
      title: 'S1',
      url: '',
      author: 'a',
      points: 10,
      commentCount: 5,
      postedDate: '2020-01-15',
    },
  ],
};

const defaultConfig: PipelineConfig = {
  useMultiAgent: true,
  providerMap: {},
  tokenBudgets: { retriever: 2000, synthesizer: 1500, synthesizerInput: 4000, writer: 1000 },
  timeout: 30000,
};

function makeLegacyEvents() {
  return (async function* () {
    yield {
      kind: 'complete' as const,
      response: {
        answer: 'legacy answer',
        steps: [],
        sources: [],
        meta: {
          provider: 'openrouter',
          totalInputTokens: 0,
          totalOutputTokens: 0,
          durationMs: 100,
          cached: false,
        },
        trust: {
          sourcesVerified: 0,
          sourcesTotal: 0,
          avgSourceAge: 0,
          recentSourceRatio: 0,
          viewpointDiversity: 'balanced' as const,
          showHnCount: 0,
          honestyFlags: [],
        },
      },
    };
  })();
}

/**
 * Helper: create a mock compiled graph whose .stream() yields [mode, data] tuples.
 * Supports both 'updates' (node completions) and 'custom' (real-time step events).
 */
function mockGraph(
  updates: Array<Record<string, unknown>>,
  customEvents: Array<{ type: string; data: unknown }> = [],
) {
  return {
    stream: jest.fn().mockResolvedValue(
      (async function* () {
        for (const update of updates) {
          const nodeName = Object.keys(update)[0];
          // Emit any custom events scheduled before this node completes
          // (In real usage, custom events interleave with updates)
          if (nodeName === 'retriever') {
            for (const ce of customEvents) {
              yield ['custom', ce];
            }
          }
          yield ['updates', update];
        }
      })(),
    ),
  };
}

/** Helper: collect all events from an async generator. */
async function collectEvents(
  gen: AsyncGenerator<PipelineStreamEvent | { kind: string; [key: string]: unknown }>,
): Promise<PipelineStreamEvent[]> {
  const events: PipelineStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event as PipelineStreamEvent);
  }
  return events;
}

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let agentService: AgentService;

  const mockLlm = {
    getModel: jest.fn(() => ({ invoke: jest.fn(), stream: jest.fn() })),
    getProviderName: jest.fn(() => 'openrouter'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestratorService,
        { provide: AgentService, useValue: { runStream: jest.fn() } },
        { provide: LlmService, useValue: mockLlm },
        { provide: HnService, useValue: {} },
        { provide: ChunkerService, useValue: {} },
      ],
    }).compile();

    service = module.get(OrchestratorService);
    agentService = module.get(AgentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /** Set up buildPipelineGraph mock with happy-path graph updates. */
  function setupHappyPathGraph() {
    const graph = mockGraph([
      { retriever: { bundle: mockBundle, steps: [] } },
      { synthesizer: { analysis: mockAnalysis } },
      { writer: { response: mockResponseV2 } },
    ]);
    (buildPipelineGraph as jest.Mock).mockReturnValue(graph);
    return graph;
  }

  describe('happy path', () => {
    it('should stream pipeline events and complete on success', async () => {
      setupHappyPathGraph();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const pipelineEvents = events.filter((e) => e.kind === 'pipeline');
      const completeEvents = events.filter((e) => e.kind === 'complete');
      // started + done for each of 3 stages = 6 pipeline events
      expect(pipelineEvents.length).toBe(6);
      expect(completeEvents.length).toBe(1);
    });

    it('should produce an answer with headline and sections', async () => {
      setupHappyPathGraph();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const complete = events.find((e) => e.kind === 'complete') as PipelineStreamEvent & {
        kind: 'complete';
        response: { answer: string };
      };
      expect(complete.response.answer).toContain('Test headline');
      expect(complete.response.answer).toContain('Body 1');
      expect(complete.response.answer).toContain('Test bottom line');
    });

    it('SSE PipelineEvents emitted at each stage transition', async () => {
      setupHappyPathGraph();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const pipelineEvents = events
        .filter((e) => e.kind === 'pipeline')
        .map((e) => {
          const pe = (e as { kind: 'pipeline'; event: PipelineEvent }).event;
          return { stage: pe.stage, status: pe.status };
        });

      expect(pipelineEvents).toEqual([
        { stage: 'retriever', status: 'started' },
        { stage: 'retriever', status: 'done' },
        { stage: 'synthesizer', status: 'started' },
        { stage: 'synthesizer', status: 'done' },
        { stage: 'writer', status: 'started' },
        { stage: 'writer', status: 'done' },
      ]);
    });

    it('PipelineResult contains valid intermediates', async () => {
      setupHappyPathGraph();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const complete = events.find((e) => e.kind === 'complete') as PipelineStreamEvent & {
        kind: 'complete';
        response: { answer: string; sources: Array<{ storyId: number; title: string }> };
      };

      expect(complete).toBeDefined();
      expect(complete.response.answer).toContain('Test headline');
      expect(complete.response.answer).toContain('Body 1');
      expect(complete.response.answer).toContain('Body 2');
      expect(complete.response.answer).toContain('Test bottom line');
      expect(complete.response.sources.length).toBeGreaterThan(0);
      expect(complete.response.sources[0].storyId).toBe(1);
      expect(complete.response.sources[0].title).toBe('S1');
    });

    it('complete response has correct meta and trust', async () => {
      setupHappyPathGraph();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const complete = events.find((e) => e.kind === 'complete') as PipelineStreamEvent & {
        kind: 'complete';
        response: {
          answer: string;
          steps: unknown[];
          sources: Array<{ storyId: number }>;
          meta: { provider: string; durationMs: number };
          trust: Record<string, unknown>;
        };
      };

      expect(complete.response.meta).toBeDefined();
      expect(complete.response.meta.provider).toBe('openrouter');
      expect(complete.response.meta.durationMs).toBeGreaterThanOrEqual(0);
      expect(complete.response.trust).toBeDefined();
      // Recency comes from the sources' structured postedDate, not tool text.
      expect(complete.response.trust['avgSourceAge']).toBeGreaterThan(730);
      expect(complete.response.trust['honestyFlags']).toContain('old_sources_noted');
    });

    it('emits step events from retriever custom events in real-time', async () => {
      const step1 = {
        type: 'action',
        content: 'search_hn(...)',
        toolName: 'search_hn',
        toolInput: {},
        timestamp: 1,
      };
      const step2 = { type: 'observation', content: 'found 3 stories', timestamp: 2 };
      const graph = mockGraph(
        [
          { retriever: { bundle: mockBundle, steps: [step1, step2] } },
          { synthesizer: { analysis: mockAnalysis } },
          { writer: { response: mockResponseV2 } },
        ],
        [
          { type: 'retriever_step', data: step1 },
          { type: 'retriever_step', data: step2 },
        ],
      );
      (buildPipelineGraph as jest.Mock).mockReturnValue(graph);

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const stepEvents = events.filter((e) => e.kind === 'step');
      expect(stepEvents.length).toBe(2);
      // Steps arrive BEFORE the retriever done event
      const retrieverDoneIdx = events.findIndex(
        (e) =>
          e.kind === 'pipeline' &&
          (e as { kind: 'pipeline'; event: PipelineEvent }).event.stage === 'retriever' &&
          (e as { kind: 'pipeline'; event: PipelineEvent }).event.status === 'done',
      );
      const lastStepIdx = events.reduce((acc, e, i) => (e.kind === 'step' ? i : acc), -1);
      expect(lastStepIdx).toBeLessThan(retrieverDoneIdx);
    });

    it('forwards writer draft deltas as token events', async () => {
      const graph = mockGraph(
        [
          { retriever: { bundle: mockBundle, steps: [] } },
          { synthesizer: { analysis: mockAnalysis } },
          { writer: { response: mockResponseV2 } },
        ],
        [
          { type: 'writer_draft', data: '## Head' },
          { type: 'writer_draft', data: 'line' },
        ],
      );
      (buildPipelineGraph as jest.Mock).mockReturnValue(graph);

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const tokens = events.filter((e) => e.kind === 'token') as Array<{ content: string }>;
      expect(tokens.map((t) => t.content)).toEqual(['## Head', 'line']);
    });
  });

  describe('retriever failure', () => {
    it('should fall back to legacy agent when retriever fails', async () => {
      // When the graph.stream() throws, runWithFallback catches and delegates
      const graph = {
        stream: jest.fn().mockRejectedValue(new Error('Retriever kaboom')),
      };
      (buildPipelineGraph as jest.Mock).mockReturnValue(graph);
      (agentService.runStream as jest.Mock).mockReturnValue(makeLegacyEvents());

      const events = await collectEvents(service.runWithFallback('test query', defaultConfig));

      expect(agentService.runStream).toHaveBeenCalledWith('test query', { provider: undefined });
      expect(
        events.some(
          (e) => e.kind === 'pipeline' && (e as PipelineStreamEvent).event.status === 'error',
        ),
      ).toBe(true);
    });

    it('falls back on the provider the user chose, not the server default', async () => {
      (buildPipelineGraph as jest.Mock).mockReturnValue({
        stream: jest.fn().mockRejectedValue(new Error('Retriever kaboom')),
      });
      (agentService.runStream as jest.Mock).mockReturnValue(makeLegacyEvents());

      await collectEvents(
        service.runWithFallback('test query', {
          ...defaultConfig,
          providerMap: { retriever: 'claude', synthesizer: 'claude', writer: 'claude' },
        }),
      );

      expect(agentService.runStream).toHaveBeenCalledWith('test query', { provider: 'claude' });
    });
  });

  describe('rejected API key', () => {
    it('fails fast with a clear error instead of re-running the legacy agent', async () => {
      const upstream = Object.assign(
        new Error('401 {"error":{"message":"Invalid API Key","code":"invalid_api_key"}}'),
        { status: 401 },
      );
      (buildPipelineGraph as jest.Mock).mockReturnValue({
        stream: jest.fn().mockRejectedValue(upstream),
      });

      const events: PipelineStreamEvent[] = [];
      await expect(async () => {
        for await (const e of service.runWithFallback('test query', defaultConfig)) {
          events.push(e as PipelineStreamEvent);
        }
      }).rejects.toThrow('The openrouter API key was rejected. Check OPENROUTER_API_KEY');

      expect(agentService.runStream).not.toHaveBeenCalled();
      expect(events.filter((e) => e.kind === 'pipeline').map((e) => e.event.detail)).toContain(
        'API key rejected',
      );
    });
  });

  describe('writer fallback', () => {
    it('should build fallback response when writer returns undefined response', async () => {
      // Writer node returns { response: undefined } (via withWriterFallback)
      const graph = mockGraph([
        { retriever: { bundle: mockBundle, steps: [] } },
        { synthesizer: { analysis: mockAnalysis } },
        { writer: { response: undefined } },
      ]);
      (buildPipelineGraph as jest.Mock).mockReturnValue(graph);

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const complete = events.find((e) => e.kind === 'complete') as PipelineStreamEvent & {
        kind: 'complete';
        response: { answer: string; meta: { error: boolean } };
      };
      expect(complete).toBeDefined();
      // Fallback uses analysis.summary as headline
      expect(complete.response.answer).toContain('Test summary');
      expect(complete.response.meta.error).toBe(true);
    });

    it('writer done event shows fallback detail when response is undefined', async () => {
      const graph = mockGraph([
        { retriever: { bundle: mockBundle, steps: [] } },
        { synthesizer: { analysis: mockAnalysis } },
        { writer: { response: undefined } },
      ]);
      (buildPipelineGraph as jest.Mock).mockReturnValue(graph);

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const writerDone = events
        .filter((e) => e.kind === 'pipeline')
        .map((e) => (e as { kind: 'pipeline'; event: PipelineEvent }).event)
        .find((pe) => pe.stage === 'writer' && pe.status === 'done');

      expect(writerDone).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(writerDone!.detail).toContain('fallback');
    });
  });

  describe('merged writer mode', () => {
    it('is off by default: the Synthesizer makes its own LLM call', async () => {
      setupHappyPathGraph();
      const { createSynthesizerNode, createMergedSynthesizerNode } = jest.requireMock(
        './nodes/synthesizer.node',
      );
      const { createWriterNode } = jest.requireMock('./nodes/writer.node');

      await collectEvents(service.runStream('test query', defaultConfig));

      expect(createSynthesizerNode).toHaveBeenCalled();
      expect(createMergedSynthesizerNode).not.toHaveBeenCalled();
      expect(createWriterNode).toHaveBeenLastCalledWith(expect.anything(), {
        fromEvidence: false,
      });
    });

    it('PIPELINE_MERGED_WRITER=true skips the Synthesizer call and writes from evidence', async () => {
      setupHappyPathGraph();
      const { createSynthesizerNode, createMergedSynthesizerNode } = jest.requireMock(
        './nodes/synthesizer.node',
      );
      const { createWriterNode } = jest.requireMock('./nodes/writer.node');
      (createSynthesizerNode as jest.Mock).mockClear();
      const merged = new OrchestratorService(
        agentService,
        mockLlm as never,
        {} as never,
        {} as never,
        { get: (key: string) => (key === 'PIPELINE_MERGED_WRITER' ? 'true' : undefined) } as never,
      );

      const events = await collectEvents(merged.runStream('test query', defaultConfig));

      expect(createMergedSynthesizerNode).toHaveBeenCalled();
      expect(createSynthesizerNode).not.toHaveBeenCalled();
      expect(createWriterNode).toHaveBeenLastCalledWith(expect.anything(), { fromEvidence: true });
      const synthDone = events.find(
        (e) =>
          e.kind === 'pipeline' && e.event.stage === 'synthesizer' && e.event.status === 'done',
      ) as { event: { detail: string } };
      expect(synthDone.event.detail).toContain('Merged into writer');
    });
  });

  describe('follow-up questions', () => {
    const prior = {
      query: 'What does HN think about Rust?',
      bundle: mockBundle,
      steps: [{ type: 'observation' as const, content: 'Found 3 stories', timestamp: 1 }],
    };

    it('reuses the prior evidence instead of running the Retriever', async () => {
      const graph = setupHappyPathGraph();
      const { createRetrieverNode } = jest.requireMock('./nodes/retriever.node');
      (createRetrieverNode as jest.Mock).mockClear();

      const events = await collectEvents(
        service.runStream('What are the complaints?', defaultConfig, prior),
      );

      expect(createRetrieverNode).not.toHaveBeenCalled();
      const { retriever } = (buildPipelineGraph as jest.Mock).mock.calls[0][0];
      const out = await retriever();
      expect(out.bundle.allSources).toEqual(mockBundle.allSources);
      expect(out.bundle.query).toBe('What are the complaints?');
      expect(out.steps).toEqual(prior.steps);
      // The earlier question travels in graph state so Synthesizer and Writer can label it.
      expect(graph.stream).toHaveBeenCalledWith(
        { query: 'What are the complaints?', priorQuery: 'What does HN think about Rust?' },
        expect.anything(),
      );

      const started = events.find((e) => e.kind === 'pipeline') as {
        event: { detail: string };
      };
      expect(started.event.detail).toContain('Reusing');
    });

    it('returns the evidence with the completed answer so it can be followed up again', async () => {
      setupHappyPathGraph();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const complete = events.find((e) => e.kind === 'complete') as {
        evidence?: { query: string; bundle: EvidenceBundle };
      };
      expect(complete.evidence?.query).toBe('test query');
      expect(complete.evidence?.bundle).toEqual(mockBundle);
    });
  });

  describe('graph construction', () => {
    it('calls buildPipelineGraph with node functions', async () => {
      setupHappyPathGraph();

      await collectEvents(service.runStream('test query', defaultConfig));

      expect(buildPipelineGraph).toHaveBeenCalledTimes(1);
      const args = (buildPipelineGraph as jest.Mock).mock.calls[0][0];
      expect(args).toHaveProperty('retriever');
      expect(args).toHaveProperty('synthesizer');
      expect(args).toHaveProperty('writer');
      expect(typeof args.retriever).toBe('function');
      expect(typeof args.synthesizer).toBe('function');
      expect(typeof args.writer).toBe('function');
    });

    it('requests JSON mode for the JSON stages but not for the ReAct tool-calling model', async () => {
      setupHappyPathGraph();

      await collectEvents(service.runStream('test query', defaultConfig));

      const calls = mockLlm.getModel.mock.calls as unknown as Array<
        [string | undefined, { json?: boolean; maxTokens?: number } | undefined]
      >;
      const jsonCalls = calls.filter(([, opts]) => opts?.json === true);
      // compaction (retriever), synthesizer, writer
      expect(jsonCalls).toHaveLength(3);
      const reactCall = calls.find(([, opts]) => opts?.maxTokens !== undefined);
      expect(reactCall?.[1]).toEqual({ maxTokens: expect.any(Number) });
    });

    it('streams with updates and custom modes', async () => {
      const graph = setupHappyPathGraph();

      await collectEvents(service.runStream('test query', defaultConfig));

      expect(graph.stream).toHaveBeenCalledWith(
        { query: 'test query' },
        { streamMode: ['updates', 'custom'] },
      );
    });
  });

  describe('retriever protection', () => {
    it('should never re-run retriever on downstream failure (graph throws)', async () => {
      // Graph stream throws after retriever update
      const graph = {
        stream: jest.fn().mockResolvedValue(
          (async function* () {
            yield ['updates', { retriever: { bundle: mockBundle, steps: [] } }];
            throw new Error('synth fail');
          })(),
        ),
      };
      (buildPipelineGraph as jest.Mock).mockReturnValue(graph);
      (agentService.runStream as jest.Mock).mockReturnValue(makeLegacyEvents());

      await collectEvents(service.runWithFallback('test query', defaultConfig));

      // Graph was only built and streamed once
      expect(buildPipelineGraph).toHaveBeenCalledTimes(1);
      expect(graph.stream).toHaveBeenCalledTimes(1);
    });
  });

  describe('integration', () => {
    it('full pipeline with mocked graph responses', async () => {
      setupHappyPathGraph();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const pipelineEvents = events.filter((e) => e.kind === 'pipeline');
      expect(pipelineEvents.length).toBe(6);

      const completeEvents = events.filter((e) => e.kind === 'complete');
      expect(completeEvents.length).toBe(1);

      const complete = completeEvents[0] as PipelineStreamEvent & {
        kind: 'complete';
        response: {
          answer: string;
          steps: unknown[];
          sources: Array<{ storyId: number }>;
          meta: { provider: string; durationMs: number };
          trust: Record<string, unknown>;
        };
      };
      expect(complete.response.answer).toBeDefined();
      expect(complete.response.answer.length).toBeGreaterThan(0);
      expect(complete.response.steps).toBeDefined();
      expect(complete.response.sources).toBeDefined();
      expect(complete.response.sources.length).toBeGreaterThan(0);
      expect(complete.response.meta).toBeDefined();
      expect(complete.response.meta.provider).toBe('openrouter');
      expect(complete.response.meta.durationMs).toBeGreaterThanOrEqual(0);
      expect(complete.response.trust).toBeDefined();
    });
  });
});
