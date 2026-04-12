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
jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
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
  sources: [{ storyId: 1, title: 'S1', url: '', author: 'a', points: 10, commentCount: 5 }],
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
          provider: 'groq',
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

/** Helper: create a mock compiled graph whose .stream() yields predefined updates. */
function mockGraph(updates: Array<Record<string, unknown>>) {
  return {
    stream: jest.fn().mockResolvedValue(
      (async function* () {
        for (const update of updates) yield update;
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
    getProviderName: jest.fn(() => 'groq'),
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
      expect(complete.response.meta.provider).toBe('groq');
      expect(complete.response.meta.durationMs).toBeGreaterThanOrEqual(0);
      expect(complete.response.trust).toBeDefined();
    });

    it('emits step events from retriever', async () => {
      const mockSteps = [
        { action: 'search_hn', input: 'test', observation: 'found 3 stories' },
        { action: 'get_story', input: '123', observation: 'story details' },
      ];
      const graph = mockGraph([
        { retriever: { bundle: mockBundle, steps: mockSteps } },
        { synthesizer: { analysis: mockAnalysis } },
        { writer: { response: mockResponseV2 } },
      ]);
      (buildPipelineGraph as jest.Mock).mockReturnValue(graph);

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const stepEvents = events.filter((e) => e.kind === 'step');
      expect(stepEvents.length).toBe(2);
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

      expect(agentService.runStream).toHaveBeenCalledWith('test query');
      expect(
        events.some(
          (e) => e.kind === 'pipeline' && (e as PipelineStreamEvent).event.status === 'error',
        ),
      ).toBe(true);
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
      expect(writerDone!.detail).toContain('fallback');
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

    it('streams with updates mode', async () => {
      const graph = setupHappyPathGraph();

      await collectEvents(service.runStream('test query', defaultConfig));

      expect(graph.stream).toHaveBeenCalledWith({ query: 'test query' }, { streamMode: 'updates' });
    });
  });

  describe('retriever protection', () => {
    it('should never re-run retriever on downstream failure (graph throws)', async () => {
      // Graph stream throws after retriever update
      let callCount = 0;
      const graph = {
        stream: jest.fn().mockResolvedValue(
          (async function* () {
            callCount++;
            yield { retriever: { bundle: mockBundle, steps: [] } };
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
      expect(complete.response.meta.provider).toBe('groq');
      expect(complete.response.meta.durationMs).toBeGreaterThanOrEqual(0);
      expect(complete.response.trust).toBeDefined();
    });
  });
});
