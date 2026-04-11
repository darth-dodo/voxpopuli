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
        jest.fn().mockResolvedValue({ bundle: mockBundle }),
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
        jest.fn().mockResolvedValue({ bundle: mockBundle }),
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
        jest.fn().mockResolvedValue({ bundle: mockBundle }),
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
        jest.fn().mockResolvedValue({ bundle: mockBundle }),
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
  });

  describe('writer failure recovery', () => {
    it('should retry writer once on failure then succeed', async () => {
      const mockWriter = jest
        .fn()
        .mockRejectedValueOnce(new Error('Writer parse error'))
        .mockResolvedValueOnce({ response: mockResponseV2 });

      (createRetrieverNode as jest.Mock).mockReturnValue(
        jest.fn().mockResolvedValue({ bundle: mockBundle }),
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
        jest.fn().mockResolvedValue({ bundle: mockBundle }),
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
        jest.fn().mockResolvedValue({ bundle: mockBundle }),
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
      const mockRetriever = jest.fn().mockResolvedValue({ bundle: mockBundle });
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
});
