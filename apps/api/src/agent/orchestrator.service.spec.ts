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
import { createRetrieverNode } from './nodes/retriever.node';
import { createSynthesizerNode } from './nodes/synthesizer.node';
import { createWriterNode } from './nodes/writer.node';

jest.mock('langchain', () => ({ createAgent: jest.fn() }));
jest.mock('./tools', () => ({ createAgentTools: jest.fn(() => []) }));
jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(() => ({ invoke: jest.fn() })),
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

/** Helper: set up all three node mocks with happy-path returns. */
function setupHappyPathMocks() {
  (createRetrieverNode as jest.Mock).mockReturnValue(
    jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] }),
  );
  (createSynthesizerNode as jest.Mock).mockReturnValue(
    jest.fn().mockResolvedValue({ analysis: mockAnalysis }),
  );
  (createWriterNode as jest.Mock).mockReturnValue(
    jest.fn().mockResolvedValue({ response: mockResponseV2 }),
  );
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

  describe('happy path', () => {
    it('should stream pipeline events and complete on success', async () => {
      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] }),
      );
      (createSynthesizerNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ analysis: mockAnalysis }),
      );
      (createWriterNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ response: mockResponseV2 }),
      );

      const events = [];
      for await (const event of service.runStream('test query', defaultConfig)) {
        events.push(event);
      }

      const pipelineEvents = events.filter((e) => e.kind === 'pipeline');
      const completeEvents = events.filter((e) => e.kind === 'complete');
      // started + done for each of 3 stages = 6 pipeline events
      expect(pipelineEvents.length).toBe(6);
      expect(completeEvents.length).toBe(1);
    });

    it('should produce an answer with headline and sections', async () => {
      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] }),
      );
      (createSynthesizerNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ analysis: mockAnalysis }),
      );
      (createWriterNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ response: mockResponseV2 }),
      );

      const events = [];
      for await (const event of service.runStream('test query', defaultConfig)) {
        events.push(event);
      }

      const complete = events.find((e) => e.kind === 'complete') as PipelineStreamEvent & {
        kind: 'complete';
        response: { answer: string };
      };
      expect(complete.response.answer).toContain('Test headline');
      expect(complete.response.answer).toContain('Body 1');
      expect(complete.response.answer).toContain('Test bottom line');
    });

    it('run calls agents in correct order', async () => {
      setupHappyPathMocks();

      await collectEvents(service.runStream('test query', defaultConfig));

      const retrieverOrder = (createRetrieverNode as jest.Mock).mock.invocationCallOrder[0];
      const synthesizerOrder = (createSynthesizerNode as jest.Mock).mock.invocationCallOrder[0];
      const writerOrder = (createWriterNode as jest.Mock).mock.invocationCallOrder[0];

      expect(retrieverOrder).toBeLessThan(synthesizerOrder);
      expect(synthesizerOrder).toBeLessThan(writerOrder);
    });

    it('SSE PipelineEvents emitted at each stage transition', async () => {
      setupHappyPathMocks();

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
      setupHappyPathMocks();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const complete = events.find((e) => e.kind === 'complete') as PipelineStreamEvent & {
        kind: 'complete';
        response: { answer: string; sources: Array<{ storyId: number; title: string }> };
      };

      expect(complete).toBeDefined();
      // Answer contains headline
      expect(complete.response.answer).toContain('Test headline');
      // Answer contains section bodies
      expect(complete.response.answer).toContain('Body 1');
      expect(complete.response.answer).toContain('Body 2');
      // Answer contains bottom line
      expect(complete.response.answer).toContain('Test bottom line');
      // Sources array is populated
      expect(complete.response.sources.length).toBeGreaterThan(0);
      expect(complete.response.sources[0].storyId).toBe(1);
      expect(complete.response.sources[0].title).toBe('S1');
    });
  });

  describe('retriever failure', () => {
    it('should fall back to legacy agent when retriever fails', async () => {
      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockRejectedValue(new Error('Retriever kaboom')),
      );
      (agentService.runStream as jest.Mock).mockReturnValue(makeLegacyEvents());

      const events = [];
      for await (const event of service.runWithFallback('test query', defaultConfig)) {
        events.push(event);
      }

      expect(agentService.runStream).toHaveBeenCalledWith('test query');
      expect(
        events.some(
          (e) => e.kind === 'pipeline' && (e as PipelineStreamEvent).event.status === 'error',
        ),
      ).toBe(true);
    });
  });

  describe('synthesizer failure recovery', () => {
    it('should retry synthesizer once on failure then succeed', async () => {
      const mockSynthesizer = jest
        .fn()
        .mockRejectedValueOnce(new Error('LLM parse error'))
        .mockResolvedValueOnce({ analysis: mockAnalysis });

      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] }),
      );
      (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
      (createWriterNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ response: mockResponseV2 }),
      );

      const events = [];
      for await (const event of service.runStream('test query', defaultConfig)) {
        events.push(event);
      }

      expect(mockSynthesizer).toHaveBeenCalledTimes(2);
      expect(events.find((e) => e.kind === 'complete')).toBeDefined();
    });

    it('should fall back to legacy after synthesizer retry fails', async () => {
      const mockSynthesizer = jest.fn().mockRejectedValue(new Error('LLM down'));

      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] }),
      );
      (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
      (agentService.runStream as jest.Mock).mockReturnValue(makeLegacyEvents());

      const events = [];
      for await (const event of service.runWithFallback('test query', defaultConfig)) {
        events.push(event);
      }

      expect(mockSynthesizer).toHaveBeenCalledTimes(2);
      expect(agentService.runStream).toHaveBeenCalledWith('test query');
    });

    it('JSON parse failure triggers retry in synthesizer', async () => {
      const mockSynthesizer = jest
        .fn()
        .mockRejectedValueOnce(new Error('JSON parse error: unexpected token'))
        .mockResolvedValueOnce({ analysis: mockAnalysis });

      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] }),
      );
      (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
      (createWriterNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ response: mockResponseV2 }),
      );

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      // Synthesizer was called twice: first failed with JSON error, second succeeded
      expect(mockSynthesizer).toHaveBeenCalledTimes(2);
      // Pipeline completed successfully after retry
      const complete = events.find((e) => e.kind === 'complete');
      expect(complete).toBeDefined();
      // An error event was emitted for the first failure
      const synthErrors = events.filter(
        (e) =>
          e.kind === 'pipeline' &&
          (e as { kind: 'pipeline'; event: PipelineEvent }).event.stage === 'synthesizer' &&
          (e as { kind: 'pipeline'; event: PipelineEvent }).event.status === 'error',
      );
      expect(synthErrors.length).toBe(1);
    });
  });

  describe('writer failure recovery', () => {
    it('should retry writer once on failure then succeed', async () => {
      const mockWriter = jest
        .fn()
        .mockRejectedValueOnce(new Error('Writer parse error'))
        .mockResolvedValueOnce({ response: mockResponseV2 });

      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] }),
      );
      (createSynthesizerNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ analysis: mockAnalysis }),
      );
      (createWriterNode as jest.Mock).mockReturnValue(mockWriter);

      const events = [];
      for await (const event of service.runStream('test query', defaultConfig)) {
        events.push(event);
      }

      expect(mockWriter).toHaveBeenCalledTimes(2);
      expect(events.find((e) => e.kind === 'complete')).toBeDefined();
    });

    it('should build fallback response when writer retry also fails', async () => {
      const mockWriter = jest.fn().mockRejectedValue(new Error('Writer broken'));

      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] }),
      );
      (createSynthesizerNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ analysis: mockAnalysis }),
      );
      (createWriterNode as jest.Mock).mockReturnValue(mockWriter);

      const events = [];
      for await (const event of service.runStream('test query', defaultConfig)) {
        events.push(event);
      }

      expect(mockWriter).toHaveBeenCalledTimes(2);
      const complete = events.find((e) => e.kind === 'complete') as PipelineStreamEvent & {
        kind: 'complete';
        response: { answer: string; meta: { error: boolean } };
      };
      expect(complete).toBeDefined();
      expect(complete.response.answer).toContain('Test summary');
      expect(complete.response.meta.error).toBe(true);
    });

    it('should emit pipeline error events on writer failure', async () => {
      const mockWriter = jest.fn().mockRejectedValue(new Error('Writer broken'));

      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] }),
      );
      (createSynthesizerNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ analysis: mockAnalysis }),
      );
      (createWriterNode as jest.Mock).mockReturnValue(mockWriter);

      const events = [];
      for await (const event of service.runStream('test query', defaultConfig)) {
        events.push(event);
      }

      const errorEvents = events.filter(
        (e) => e.kind === 'pipeline' && (e as PipelineStreamEvent).event.status === 'error',
      );
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
      expect((errorEvents[0] as PipelineStreamEvent).event.stage).toBe('writer');
    });
  });

  describe('retriever protection', () => {
    it('should never re-run retriever on downstream failure', async () => {
      const mockRetriever = jest.fn().mockResolvedValue({ bundle: mockBundle, steps: [] });
      const mockSynthesizer = jest.fn().mockRejectedValue(new Error('synth fail'));

      (createRetrieverNode as jest.Mock).mockReturnValue(mockRetriever);
      (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
      (agentService.runStream as jest.Mock).mockReturnValue(makeLegacyEvents());

      const events = [];
      for await (const event of service.runWithFallback('test query', defaultConfig)) {
        events.push(event);
      }

      expect(mockRetriever).toHaveBeenCalledTimes(1);
    });
  });

  describe('integration', () => {
    it('full pipeline with mocked LLM responses', async () => {
      setupHappyPathMocks();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      // 6 pipeline events: started + done for each of 3 stages
      const pipelineEvents = events.filter((e) => e.kind === 'pipeline');
      expect(pipelineEvents.length).toBe(6);

      // Exactly 1 complete event
      const completeEvents = events.filter((e) => e.kind === 'complete');
      expect(completeEvents.length).toBe(1);

      // Complete response has correct structure
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

    it('pipeline events have increasing elapsed times', async () => {
      setupHappyPathMocks();

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const pipelineEvents = events
        .filter((e) => e.kind === 'pipeline')
        .map((e) => (e as { kind: 'pipeline'; event: PipelineEvent }).event);

      // Each elapsed value should be >= the previous one
      for (let i = 1; i < pipelineEvents.length; i++) {
        expect(pipelineEvents[i].elapsed).toBeGreaterThanOrEqual(pipelineEvents[i - 1].elapsed);
      }
    });
  });

  describe('timeout behavior', () => {
    it('long-running stage completes and reports elapsed time', async () => {
      // Mock retriever to resolve after a small delay
      const delayedRetriever = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ bundle: mockBundle, steps: [] }), 50),
            ),
        );

      (createRetrieverNode as jest.Mock).mockReturnValue(delayedRetriever);
      (createSynthesizerNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ analysis: mockAnalysis }),
      );
      (createWriterNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ response: mockResponseV2 }),
      );

      const events = await collectEvents(service.runStream('test query', defaultConfig));

      // Retriever was called successfully
      expect(delayedRetriever).toHaveBeenCalledTimes(1);

      // The retriever "done" event should have a non-zero elapsed time
      const retrieverDone = events
        .filter((e) => e.kind === 'pipeline')
        .map((e) => (e as { kind: 'pipeline'; event: PipelineEvent }).event)
        .find((pe) => pe.stage === 'retriever' && pe.status === 'done');

      expect(retrieverDone).toBeDefined();
      expect(retrieverDone!.elapsed).toBeGreaterThan(0);

      // Pipeline still completes successfully
      const complete = events.find((e) => e.kind === 'complete');
      expect(complete).toBeDefined();
    });
  });
});
