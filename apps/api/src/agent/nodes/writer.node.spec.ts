import {
  AgentResponseV2Schema,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';

jest.mock('../../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

// Mock dispatchCustomEvent
const mockDispatch = jest.fn();
jest.mock('@langchain/core/callbacks/dispatch', () => ({
  dispatchCustomEvent: (...args: unknown[]) => mockDispatch(...args),
}));

import { createWriterNode } from './writer.node';

const SAMPLE_BUNDLE: EvidenceBundle = {
  query: 'React vs Vue',
  themes: [
    { label: 'Perf', items: [{ sourceId: 1, text: 'Fast', type: 'evidence', relevance: 0.9 }] },
  ],
  allSources: [{ storyId: 1, title: 'Story', url: '', author: 'a', points: 10, commentCount: 0 }],
  totalSourcesScanned: 5,
  tokenCount: 200,
};

const SAMPLE_ANALYSIS: AnalysisResult = {
  summary: 'React leads in adoption',
  insights: [
    {
      claim: 'React is popular',
      reasoning: 'Most cited',
      evidenceStrength: 'strong',
      themeIndices: [0],
    },
  ],
  contradictions: [],
  confidence: 'medium',
  gaps: ['No Vue 4 data'],
};

describe('WriterNode', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockModel = { invoke: jest.fn() } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should produce a valid AgentResponseV2', async () => {
    const responseJson = JSON.stringify({
      headline: 'React remains the top framework choice in 2026',
      context: 'Based on HN discussion trends.',
      sections: [
        { heading: 'Adoption', body: 'React leads [1].', citedSources: [1] },
        { heading: 'Community', body: 'Active community [1].', citedSources: [1] },
      ],
      bottomLine: 'React is the safe bet for enterprise.',
      sources: SAMPLE_BUNDLE.allSources,
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'React vs Vue',
      bundle: SAMPLE_BUNDLE,
      analysis: SAMPLE_ANALYSIS,
      events: [],
    });

    expect(result.response).toBeDefined();
    const parsed = AgentResponseV2Schema.safeParse(result.response);
    expect(parsed.success).toBe(true);
  });

  it('should retry on invalid JSON and succeed', async () => {
    const validJson = JSON.stringify({
      headline: 'h',
      context: 'c',
      sections: [
        { heading: 'S1', body: 'b1', citedSources: [1] },
        { heading: 'S2', body: 'b2', citedSources: [1] },
      ],
      bottomLine: 'bl',
      sources: SAMPLE_BUNDLE.allSources,
    });
    mockModel.invoke
      .mockResolvedValueOnce({ content: 'not valid json' })
      .mockResolvedValueOnce({ content: validJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'test',
      bundle: SAMPLE_BUNDLE,
      analysis: SAMPLE_ANALYSIS,
      events: [],
    });

    expect(result.response).toBeDefined();
    expect(mockModel.invoke).toHaveBeenCalledTimes(2);
  });

  it('should throw on double failure', async () => {
    mockModel.invoke
      .mockResolvedValueOnce({ content: 'bad' })
      .mockResolvedValueOnce({ content: 'still bad' });

    const node = createWriterNode(mockModel);
    await expect(
      node({ query: 'test', bundle: SAMPLE_BUNDLE, analysis: SAMPLE_ANALYSIS, events: [] }),
    ).rejects.toThrow();
  });

  it('should emit pipeline events', async () => {
    const responseJson = JSON.stringify({
      headline: 'h',
      context: 'c',
      sections: [
        { heading: 'S1', body: 'b1', citedSources: [] },
        { heading: 'S2', body: 'b2', citedSources: [] },
      ],
      bottomLine: 'bl',
      sources: [],
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    await node({
      query: 'test',
      bundle: SAMPLE_BUNDLE,
      analysis: SAMPLE_ANALYSIS,
    });

    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenNthCalledWith(
      1,
      'pipeline_event',
      expect.objectContaining({ stage: 'writer', status: 'started' }),
    );
    expect(mockDispatch).toHaveBeenNthCalledWith(
      2,
      'pipeline_event',
      expect.objectContaining({ stage: 'writer', status: 'done' }),
    );
  });
});
