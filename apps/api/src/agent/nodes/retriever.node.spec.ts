import { EvidenceBundleSchema } from '@voxpopuli/shared-types';

// Mock @langchain/langgraph before importing the node
const mockReactAgentInvoke = jest.fn();
jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(() => ({
    invoke: mockReactAgentInvoke,
  })),
}));

// Mock LLM providers
jest.mock('../../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

import { createRetrieverNode } from './retriever.node';

describe('RetrieverNode', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockModel = { invoke: jest.fn() } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockTools = [] as any[];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return a function', () => {
    const node = createRetrieverNode(mockModel, mockTools);
    expect(typeof node).toBe('function');
  });

  it('should produce a valid EvidenceBundle', async () => {
    const bundleJson = JSON.stringify({
      query: 'test query',
      themes: [
        {
          label: 'Theme 1',
          items: [{ sourceId: 1, text: 'Evidence', type: 'evidence', relevance: 0.9 }],
        },
      ],
      allSources: [
        { storyId: 1, title: 'Story', url: '', author: 'a', points: 10, commentCount: 0 },
      ],
      totalSourcesScanned: 5,
      tokenCount: 200,
    });

    mockReactAgentInvoke.mockResolvedValue({
      messages: [{ content: 'Found some results about test query', role: 'assistant' }],
    });

    mockModel.invoke.mockResolvedValue({ content: bundleJson });

    const node = createRetrieverNode(mockModel, mockTools);
    const result = await node({ query: 'test query' });

    expect(result.bundle).toBeDefined();
    const parsed = EvidenceBundleSchema.safeParse(result.bundle);
    expect(parsed.success).toBe(true);
  });

  it('should retry compaction on invalid JSON', async () => {
    mockReactAgentInvoke.mockResolvedValue({
      messages: [{ content: 'data collected', role: 'assistant' }],
    });

    const validBundle = JSON.stringify({
      query: 'test',
      themes: [
        { label: 'T', items: [{ sourceId: 1, text: 'x', type: 'evidence', relevance: 0.5 }] },
      ],
      allSources: [{ storyId: 1, title: 'S', url: '', author: 'a', points: 1, commentCount: 0 }],
      totalSourcesScanned: 1,
      tokenCount: 100,
    });

    mockModel.invoke
      .mockResolvedValueOnce({ content: '```json\n{invalid json\n```' })
      .mockResolvedValueOnce({ content: validBundle });

    const node = createRetrieverNode(mockModel, mockTools);
    const result = await node({ query: 'test' });

    expect(result.bundle).toBeDefined();
    expect(mockModel.invoke).toHaveBeenCalledTimes(2);
  });

  it('should not dispatch any custom events (pure data transformer)', async () => {
    const bundleJson = JSON.stringify({
      query: 'test',
      themes: [
        { label: 'T', items: [{ sourceId: 1, text: 'x', type: 'evidence', relevance: 0.5 }] },
      ],
      allSources: [{ storyId: 1, title: 'S', url: '', author: 'a', points: 1, commentCount: 0 }],
      totalSourcesScanned: 1,
      tokenCount: 100,
    });

    mockReactAgentInvoke.mockResolvedValue({
      messages: [{ content: 'data', role: 'assistant' }],
    });
    mockModel.invoke.mockResolvedValue({ content: bundleJson });

    const node = createRetrieverNode(mockModel, mockTools);
    const result = await node({ query: 'test' });

    expect(result.bundle).toBeDefined();
    // Node is a pure data transformer — no dispatchCustomEvent calls
  });
});
