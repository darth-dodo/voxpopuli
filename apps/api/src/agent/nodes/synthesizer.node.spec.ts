import { AnalysisResultSchema, type EvidenceBundle } from '@voxpopuli/shared-types';

// Mock LLM providers
jest.mock('../../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

// Mock dispatchCustomEvent
const mockDispatch = jest.fn();
jest.mock('@langchain/core/callbacks/dispatch', () => ({
  dispatchCustomEvent: (...args: unknown[]) => mockDispatch(...args),
}));

import { createSynthesizerNode } from './synthesizer.node';

const SAMPLE_BUNDLE: EvidenceBundle = {
  query: 'React vs Vue',
  themes: [
    {
      label: 'Performance',
      items: [{ sourceId: 1, text: 'React is fast', type: 'evidence', relevance: 0.9 }],
    },
  ],
  allSources: [{ storyId: 1, title: 'Story', url: '', author: 'a', points: 10, commentCount: 0 }],
  totalSourcesScanned: 5,
  tokenCount: 200,
};

describe('SynthesizerNode', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockModel = { invoke: jest.fn() } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should produce a valid AnalysisResult', async () => {
    const analysisJson = JSON.stringify({
      summary: 'React leads in performance benchmarks',
      insights: [
        {
          claim: 'React is faster',
          reasoning: 'Benchmarks show 40% improvement',
          evidenceStrength: 'strong',
          themeIndices: [0],
        },
      ],
      contradictions: [],
      confidence: 'medium',
      gaps: ['No Vue 4 data available'],
    });
    mockModel.invoke.mockResolvedValue({ content: analysisJson });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'React vs Vue', bundle: SAMPLE_BUNDLE, events: [] });

    expect(result.analysis).toBeDefined();
    const parsed = AnalysisResultSchema.safeParse(result.analysis);
    expect(parsed.success).toBe(true);
  });

  it('should strip markdown fences before parsing', async () => {
    const analysisJson = JSON.stringify({
      summary: 'test',
      insights: [{ claim: 'c', reasoning: 'r', evidenceStrength: 'weak', themeIndices: [0] }],
      contradictions: [],
      confidence: 'low',
      gaps: [],
    });
    mockModel.invoke.mockResolvedValue({ content: '```json\n' + analysisJson + '\n```' });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'test', bundle: SAMPLE_BUNDLE, events: [] });

    expect(result.analysis).toBeDefined();
  });

  it('should retry on invalid JSON and succeed', async () => {
    const validJson = JSON.stringify({
      summary: 'test',
      insights: [{ claim: 'c', reasoning: 'r', evidenceStrength: 'moderate', themeIndices: [0] }],
      contradictions: [],
      confidence: 'medium',
      gaps: [],
    });
    mockModel.invoke
      .mockResolvedValueOnce({ content: 'not json at all' })
      .mockResolvedValueOnce({ content: validJson });

    const node = createSynthesizerNode(mockModel);
    const result = await node({ query: 'test', bundle: SAMPLE_BUNDLE, events: [] });

    expect(result.analysis).toBeDefined();
    expect(mockModel.invoke).toHaveBeenCalledTimes(2);
  });

  it('should throw on double failure', async () => {
    mockModel.invoke
      .mockResolvedValueOnce({ content: 'bad' })
      .mockResolvedValueOnce({ content: 'still bad' });

    const node = createSynthesizerNode(mockModel);
    await expect(node({ query: 'test', bundle: SAMPLE_BUNDLE, events: [] })).rejects.toThrow();
  });

  it('should emit pipeline events', async () => {
    const analysisJson = JSON.stringify({
      summary: 'test',
      insights: [{ claim: 'c', reasoning: 'r', evidenceStrength: 'moderate', themeIndices: [0] }],
      contradictions: [],
      confidence: 'medium',
      gaps: [],
    });
    mockModel.invoke.mockResolvedValue({ content: analysisJson });

    const node = createSynthesizerNode(mockModel);
    await node({ query: 'test', bundle: SAMPLE_BUNDLE });

    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenNthCalledWith(
      1,
      'pipeline_event',
      expect.objectContaining({ stage: 'synthesizer', status: 'started' }),
    );
    expect(mockDispatch).toHaveBeenNthCalledWith(
      2,
      'pipeline_event',
      expect.objectContaining({ stage: 'synthesizer', status: 'done' }),
    );
  });
});
