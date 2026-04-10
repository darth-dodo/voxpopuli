import { Test, TestingModule } from '@nestjs/testing';
import { OrchestratorService } from './orchestrator.service';
import { AgentService } from './agent.service';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import type { PipelineConfig } from '@voxpopuli/shared-types';

// Mock everything
jest.mock('langchain', () => ({ createAgent: jest.fn() }));
jest.mock('./tools', () => ({ createAgentTools: jest.fn(() => []) }));
jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

// Mock LangGraph
const mockGraphStreamEvents = jest.fn();
jest.mock('@langchain/langgraph', () => {
  const annotationFn = Object.assign(
    jest.fn(() => 'annotation-field'),
    {
      Root: jest.fn((schema: unknown) => schema),
    },
  );
  return {
    StateGraph: jest.fn().mockImplementation(() => ({
      addNode: jest.fn().mockReturnThis(),
      addEdge: jest.fn().mockReturnThis(),
      compile: jest.fn().mockReturnValue({
        streamEvents: mockGraphStreamEvents,
      }),
    })),
    Annotation: annotationFn,
    START: '__start__',
    END: '__end__',
  };
});

jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(() => ({ invoke: jest.fn() })),
}));

// Mock node factories
jest.mock('./nodes/retriever.node', () => ({
  createRetrieverNode: jest.fn(() => jest.fn()),
}));
jest.mock('./nodes/synthesizer.node', () => ({
  createSynthesizerNode: jest.fn(() => jest.fn()),
}));
jest.mock('./nodes/writer.node', () => ({
  createWriterNode: jest.fn(() => jest.fn()),
}));

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let agentService: AgentService;

  const mockLlm = {
    getModel: jest.fn(() => ({ invoke: jest.fn(), stream: jest.fn() })),
    getProviderName: jest.fn(() => 'groq'),
  };
  const mockHn = {};
  const mockChunker = {};

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestratorService,
        { provide: AgentService, useValue: { runStream: jest.fn() } },
        { provide: LlmService, useValue: mockLlm },
        { provide: HnService, useValue: mockHn },
        { provide: ChunkerService, useValue: mockChunker },
      ],
    }).compile();

    service = module.get(OrchestratorService);
    agentService = module.get(AgentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should fall back to legacy agent on pipeline error', async () => {
    // Make streamEvents throw
    // eslint-disable-next-line require-yield
    mockGraphStreamEvents.mockImplementation(async function* () {
      throw new Error('Pipeline kaboom');
    });

    const mockLegacyEvents = (async function* () {
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
    (agentService.runStream as jest.Mock).mockReturnValue(mockLegacyEvents);

    const config: PipelineConfig = {
      useMultiAgent: true,
      providerMap: {},
      tokenBudgets: {
        retriever: 2000,
        synthesizer: 1500,
        synthesizerInput: 4000,
        writer: 1000,
      },
      timeout: 30000,
    };

    const events = [];
    for await (const event of service.runWithFallback('test query', config)) {
      events.push(event);
    }

    expect(agentService.runStream).toHaveBeenCalledWith('test query');
    // Should have error pipeline event + legacy complete event
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toMatchObject({ kind: 'pipeline' });
  });

  it('should stream pipeline events on success', async () => {
    // Mock streamEvents to yield custom pipeline events + chain_end with response
    mockGraphStreamEvents.mockImplementation(async function* () {
      yield {
        event: 'on_custom_event',
        name: 'pipeline_event',
        data: { stage: 'retriever', status: 'started', detail: 'Searching...', elapsed: 0 },
      };
      yield {
        event: 'on_custom_event',
        name: 'pipeline_event',
        data: { stage: 'retriever', status: 'done', detail: '3 themes', elapsed: 500 },
      };
      yield {
        event: 'on_custom_event',
        name: 'pipeline_event',
        data: { stage: 'synthesizer', status: 'done', detail: '3 insights', elapsed: 800 },
      };
      yield {
        event: 'on_custom_event',
        name: 'pipeline_event',
        data: { stage: 'writer', status: 'done', detail: '2 sections', elapsed: 1200 },
      };
      yield {
        event: 'on_chain_end',
        data: {
          output: {
            response: {
              headline: 'Test headline',
              context: 'Test context',
              sections: [
                { heading: 'S1', body: 'Body 1', citedSources: [1] },
                { heading: 'S2', body: 'Body 2', citedSources: [2] },
              ],
              bottomLine: 'Test bottom line',
              sources: [
                {
                  storyId: 1,
                  title: 'T',
                  url: '',
                  author: 'a',
                  points: 10,
                  commentCount: 0,
                },
              ],
            },
          },
        },
      };
    });

    const config: PipelineConfig = {
      useMultiAgent: true,
      providerMap: {},
      tokenBudgets: {
        retriever: 2000,
        synthesizer: 1500,
        synthesizerInput: 4000,
        writer: 1000,
      },
      timeout: 30000,
    };

    const events = [];
    for await (const event of service.runStream('test query', config)) {
      events.push(event);
    }

    // Should have pipeline events + complete
    const pipelineEvents = events.filter((e) => e.kind === 'pipeline');
    const completeEvents = events.filter((e) => e.kind === 'complete');
    expect(pipelineEvents.length).toBe(4);
    expect(completeEvents.length).toBe(1);
  });
});
