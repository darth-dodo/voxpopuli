import {
  buildPipelineGraph,
  withRetry,
  withWriterFallback,
  type PipelineGraphState,
} from './pipeline-graph';
import type { EvidenceBundle, AnalysisResult, AgentResponseV2 } from '@voxpopuli/shared-types';

jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

const mockBundle: EvidenceBundle = {
  query: 'test query',
  themes: [
    {
      label: 'Theme1',
      items: [{ sourceId: 1, text: 'evidence text', type: 'evidence', relevance: 0.9 }],
    },
  ],
  allSources: [
    { storyId: 1, title: 'Story 1', url: '', author: 'alice', points: 42, commentCount: 10 },
  ],
  totalSourcesScanned: 5,
  tokenCount: 800,
};

const mockAnalysis: AnalysisResult = {
  summary: 'Analysis summary',
  insights: [
    {
      claim: 'Insight 1',
      reasoning: 'Because data',
      evidenceStrength: 'strong',
      themeIndices: [0],
    },
  ],
  contradictions: [],
  confidence: 'high',
  gaps: [],
};

const mockResponse: AgentResponseV2 = {
  headline: 'Response headline',
  context: 'Response context',
  sections: [{ heading: 'Section 1', body: 'Section body', citedSources: [1] }],
  bottomLine: 'Bottom line',
  sources: [
    { storyId: 1, title: 'Story 1', url: '', author: 'alice', points: 42, commentCount: 10 },
  ],
};

describe('buildPipelineGraph', () => {
  it('should compile a graph with three nodes in order', async () => {
    const executionOrder: string[] = [];

    const retriever = jest.fn(async (state: PipelineGraphState) => {
      executionOrder.push('retriever');
      return { bundle: mockBundle };
    });
    const synthesizer = jest.fn(async (state: PipelineGraphState) => {
      executionOrder.push('synthesizer');
      return { analysis: mockAnalysis };
    });
    const writer = jest.fn(async (state: PipelineGraphState) => {
      executionOrder.push('writer');
      return { response: mockResponse };
    });

    const graph = buildPipelineGraph({ retriever, synthesizer, writer });
    const updates: { nodeName: string }[] = [];

    for await (const update of await graph.stream(
      { query: 'test query' },
      { streamMode: 'updates' },
    )) {
      const nodeName = Object.keys(update)[0];
      updates.push({ nodeName });
    }

    expect(executionOrder).toEqual(['retriever', 'synthesizer', 'writer']);
    expect(updates).toHaveLength(3);
    expect(updates.map((u) => u.nodeName)).toEqual(['retriever', 'synthesizer', 'writer']);
  });

  it('should propagate state between nodes', async () => {
    const retriever = jest.fn(async () => ({ bundle: mockBundle }));
    const synthesizer = jest.fn(async (state: PipelineGraphState) => {
      // Synthesizer should see the bundle set by retriever
      expect(state.bundle).toEqual(mockBundle);
      return { analysis: mockAnalysis };
    });
    const writer = jest.fn(async (state: PipelineGraphState) => {
      // Writer should see both bundle and analysis
      expect(state.bundle).toEqual(mockBundle);
      expect(state.analysis).toEqual(mockAnalysis);
      return { response: mockResponse };
    });

    const graph = buildPipelineGraph({ retriever, synthesizer, writer });
    const finalState = await graph.invoke({ query: 'test query' });

    expect(retriever).toHaveBeenCalledTimes(1);
    expect(synthesizer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(finalState.response).toEqual(mockResponse);
  });

  it('steps reducer should accumulate across nodes', async () => {
    const step1 = { type: 'thought' as const, content: 'Thinking...', timestamp: Date.now() };
    const step2 = {
      type: 'action' as const,
      content: 'Searching...',
      toolName: 'search_hn',
      timestamp: Date.now(),
    };
    const step3 = { type: 'observation' as const, content: 'Found results', timestamp: Date.now() };

    const retriever = jest.fn(async () => ({
      bundle: mockBundle,
      steps: [step1, step2],
    }));
    const synthesizer = jest.fn(async (state: PipelineGraphState) => {
      // Synthesizer should see the retriever's steps
      expect(state.steps).toEqual([step1, step2]);
      return { analysis: mockAnalysis, steps: [step3] };
    });
    const writer = jest.fn(async (state: PipelineGraphState) => {
      // Writer should see all accumulated steps
      expect(state.steps).toEqual([step1, step2, step3]);
      return { response: mockResponse };
    });

    const graph = buildPipelineGraph({ retriever, synthesizer, writer });
    const finalState = await graph.invoke({ query: 'test query' });

    expect(finalState.steps).toEqual([step1, step2, step3]);
  });
});

const minimalState: PipelineGraphState = {
  query: 'q',
  bundle: undefined,
  analysis: undefined,
  response: undefined,
  steps: [],
};

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const fn = jest.fn().mockResolvedValue({ analysis: 'ok' });
    const wrapped = withRetry(fn);
    const result = await wrapped(minimalState);
    expect(result).toEqual({ analysis: 'ok' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry once on failure then return', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ analysis: 'ok' });
    const wrapped = withRetry(fn);
    const result = await wrapped(minimalState);
    expect(result).toEqual({ analysis: 'ok' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw on double failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const wrapped = withRetry(fn);
    await expect(wrapped(minimalState)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withWriterFallback', () => {
  it('should return result on success', async () => {
    const fn = jest.fn().mockResolvedValue({ response: 'ok' });
    const fallback = jest.fn();
    const wrapped = withWriterFallback(fn, fallback);
    const result = await wrapped(minimalState);
    expect(result).toEqual({ response: 'ok' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('should retry once then use fallback on double failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const fallback = jest.fn().mockReturnValue({ response: 'fallback' });
    const wrapped = withWriterFallback(fn, fallback);
    const stateWithData: PipelineGraphState = {
      ...minimalState,
      bundle: mockBundle,
      analysis: mockAnalysis,
    };
    const result = await wrapped(stateWithData);
    expect(result).toEqual({ response: 'fallback' });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
