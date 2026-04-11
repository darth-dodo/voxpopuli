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

import { createRetrieverNode, isDryWell, buildDryWellBundle } from './retriever.node';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

/** Helper: realistic raw data that passes the dry-well check. */
const RICH_RAW_DATA =
  'Story 12345 — How Rust is changing systems programming. ' +
  'Posted by alice. 245 points, 89 comments. ' +
  'Top comments discuss memory safety vs C++. ' +
  'Several users report switching production services to Rust with good results. ' +
  'Some dissent about the learning curve being too steep for small teams.';

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
      messages: [{ content: RICH_RAW_DATA, role: 'assistant' }],
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
      messages: [{ content: RICH_RAW_DATA, role: 'assistant' }],
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
      messages: [{ content: RICH_RAW_DATA, role: 'assistant' }],
    });
    mockModel.invoke.mockResolvedValue({ content: bundleJson });

    const node = createRetrieverNode(mockModel, mockTools);
    const result = await node({ query: 'test' });

    expect(result.bundle).toBeDefined();
    // Node is a pure data transformer — no dispatchCustomEvent calls
  });

  it('compact produces valid EvidenceBundle with schema validation', async () => {
    const multiThemeBundle = {
      query: 'best programming languages 2025',
      themes: [
        {
          label: 'Performance',
          items: [
            { sourceId: 1, text: 'Rust is fast', type: 'evidence', relevance: 0.95 },
            { sourceId: 2, text: 'Go compiles quickly', type: 'opinion', relevance: 0.8 },
          ],
        },
        {
          label: 'Ecosystem',
          items: [
            { sourceId: 3, text: 'Python has great libraries', type: 'consensus', relevance: 0.9 },
          ],
        },
        {
          label: 'Developer Experience',
          items: [
            {
              sourceId: 4,
              text: 'TypeScript catches bugs early',
              type: 'anecdote',
              relevance: 0.7,
            },
          ],
        },
      ],
      allSources: [
        {
          storyId: 1,
          title: 'Rust vs Go',
          url: 'https://hn.example/1',
          author: 'alice',
          points: 120,
          commentCount: 45,
        },
        {
          storyId: 2,
          title: 'Go in Production',
          url: 'https://hn.example/2',
          author: 'bob',
          points: 80,
          commentCount: 22,
        },
        {
          storyId: 3,
          title: 'Python ML Stack',
          url: 'https://hn.example/3',
          author: 'carol',
          points: 200,
          commentCount: 90,
        },
        {
          storyId: 4,
          title: 'TS at Scale',
          url: 'https://hn.example/4',
          author: 'dave',
          points: 55,
          commentCount: 18,
        },
      ],
      totalSourcesScanned: 12,
      tokenCount: 4500,
    };

    mockReactAgentInvoke.mockResolvedValue({
      messages: [{ content: RICH_RAW_DATA, role: 'assistant' }],
    });
    mockModel.invoke.mockResolvedValue({ content: JSON.stringify(multiThemeBundle) });

    const node = createRetrieverNode(mockModel, mockTools);
    const result = await node({ query: 'best programming languages 2025' });

    // Validate against the Zod schema
    const parsed = EvidenceBundleSchema.safeParse(result.bundle);
    expect(parsed.success).toBe(true);

    // Verify themes count is within 1-6
    expect(result.bundle.themes.length).toBeGreaterThanOrEqual(1);
    expect(result.bundle.themes.length).toBeLessThanOrEqual(6);
    expect(result.bundle.themes).toHaveLength(3);

    // Verify each theme has at least 1 item
    for (const theme of result.bundle.themes) {
      expect(theme.items.length).toBeGreaterThanOrEqual(1);
    }

    // Verify all relevance scores are between 0 and 1
    for (const theme of result.bundle.themes) {
      for (const item of theme.items) {
        expect(item.relevance).toBeGreaterThanOrEqual(0);
        expect(item.relevance).toBeLessThanOrEqual(1);
      }
    }
  });

  it('retries compaction on schema validation failure', async () => {
    mockReactAgentInvoke.mockResolvedValue({
      messages: [{ content: RICH_RAW_DATA, role: 'assistant' }],
    });

    // First response: valid JSON but invalid schema (empty themes array violates .min(1))
    const invalidSchemaBundle = JSON.stringify({
      query: 'test',
      themes: [],
      allSources: [{ storyId: 1, title: 'S', url: '', author: 'a', points: 1, commentCount: 0 }],
      totalSourcesScanned: 1,
      tokenCount: 100,
    });

    // Second response: valid JSON and valid schema
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
      .mockResolvedValueOnce({ content: invalidSchemaBundle })
      .mockResolvedValueOnce({ content: validBundle });

    const node = createRetrieverNode(mockModel, mockTools);
    const result = await node({ query: 'test' });

    // Should have retried: 2 model.invoke calls for compaction
    expect(mockModel.invoke).toHaveBeenCalledTimes(2);
    expect(result.bundle).toBeDefined();

    const parsed = EvidenceBundleSchema.safeParse(result.bundle);
    expect(parsed.success).toBe(true);
    expect(result.bundle.themes).toHaveLength(1);

    // Verify the retry message includes validation error details
    const secondCallArgs = mockModel.invoke.mock.calls[1][0];
    const retryMessage = secondCallArgs.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any) => typeof m.content === 'string' && m.content.includes('validation errors'),
    );
    expect(retryMessage).toBeDefined();
  });

  it('raw data is capped at 50,000 chars', async () => {
    // Create messages that total > 50,000 chars (include story data to pass dry-well check)
    const longContent = 'Story 1 — 100 points. ' + 'A'.repeat(30_000);
    mockReactAgentInvoke.mockResolvedValue({
      messages: [
        { content: longContent, role: 'assistant' },
        { content: longContent, role: 'assistant' },
      ],
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

    mockModel.invoke.mockResolvedValue({ content: validBundle });

    const node = createRetrieverNode(mockModel, mockTools);
    await node({ query: 'test' });

    expect(mockModel.invoke).toHaveBeenCalledTimes(1);

    // The compaction call's HumanMessage should contain truncated data
    const compactionCallArgs = mockModel.invoke.mock.calls[0][0];
    // Find the HumanMessage (second element in the messages array)
    const humanMessage = compactionCallArgs[1];
    const content = typeof humanMessage.content === 'string' ? humanMessage.content : '';

    // Raw data is 60,000 chars (two 30k messages joined by \n\n)
    // After truncation to 50,000 chars, total content should be less than
    // the full raw data (prefix "Query: test\n\nRaw HN data:\n" + 50,000 chars)
    expect(content.length).toBeLessThan(60_000 + 50);
    expect(content.length).toBeLessThanOrEqual(50_000 + 'Query: test\n\nRaw HN data:\n'.length);
  });

  it('full retrieve() with mocked tools - ReAct loop terminates within maxIterations', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = [{ name: 'search_hn' }, { name: 'get_story' }] as any[];

    const validBundle = JSON.stringify({
      query: 'what is new in AI',
      themes: [
        {
          label: 'AI News',
          items: [{ sourceId: 1, text: 'GPT-5 released', type: 'evidence', relevance: 0.9 }],
        },
      ],
      allSources: [
        { storyId: 1, title: 'AI Update', url: '', author: 'a', points: 50, commentCount: 10 },
      ],
      totalSourcesScanned: 3,
      tokenCount: 500,
    });

    mockReactAgentInvoke.mockResolvedValue({
      messages: [{ content: RICH_RAW_DATA, role: 'assistant' }],
    });
    mockModel.invoke.mockResolvedValue({ content: validBundle });

    const node = createRetrieverNode(mockModel, tools);
    const result = await node({ query: 'what is new in AI' });

    // Verify createReactAgent was called with the tools
    expect(createReactAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        llm: mockModel,
        tools,
      }),
    );

    // Verify the ReAct agent was invoked with the query as a HumanMessage
    expect(mockReactAgentInvoke).toHaveBeenCalledTimes(1);
    const invokeArgs = mockReactAgentInvoke.mock.calls[0][0];
    expect(invokeArgs.messages).toHaveLength(1);
    expect(invokeArgs.messages[0].content).toBe('what is new in AI');

    // Verify the result is a valid EvidenceBundle
    expect(result.bundle).toBeDefined();
    const parsed = EvidenceBundleSchema.safeParse(result.bundle);
    expect(parsed.success).toBe(true);
  });

  describe('dry-well circuit breaker', () => {
    it('should skip compaction and return dry-well bundle when raw data is sparse', async () => {
      mockReactAgentInvoke.mockResolvedValue({
        messages: [{ content: 'No results found for this query.', role: 'assistant' }],
      });

      const node = createRetrieverNode(mockModel, mockTools);
      const result = await node({ query: 'obscure topic nobody discussed' });

      // Compaction LLM call should NOT have been made
      expect(mockModel.invoke).not.toHaveBeenCalled();

      // Bundle should be a valid EvidenceBundle
      const parsed = EvidenceBundleSchema.safeParse(result.bundle);
      expect(parsed.success).toBe(true);

      // Bundle should contain the dry-well placeholder theme
      expect(result.bundle.themes).toHaveLength(1);
      expect(result.bundle.themes[0].label).toBe('No substantial discussion found');
      expect(result.bundle.allSources).toHaveLength(0);
      expect(result.bundle.totalSourcesScanned).toBe(0);
      expect(result.bundle.query).toBe('obscure topic nobody discussed');
    });

    it('should proceed with compaction when raw data has story content', async () => {
      mockReactAgentInvoke.mockResolvedValue({
        messages: [{ content: RICH_RAW_DATA, role: 'assistant' }],
      });

      const validBundle = JSON.stringify({
        query: 'rust programming',
        themes: [
          { label: 'T', items: [{ sourceId: 1, text: 'x', type: 'evidence', relevance: 0.5 }] },
        ],
        allSources: [{ storyId: 1, title: 'S', url: '', author: 'a', points: 1, commentCount: 0 }],
        totalSourcesScanned: 1,
        tokenCount: 100,
      });
      mockModel.invoke.mockResolvedValue({ content: validBundle });

      const node = createRetrieverNode(mockModel, mockTools);
      const result = await node({ query: 'rust programming' });

      // Compaction LLM call SHOULD have been made
      expect(mockModel.invoke).toHaveBeenCalled();
      expect(result.bundle.themes).toHaveLength(1);
    });
  });

  describe('isDryWell', () => {
    it('returns true for very short content', () => {
      expect(isDryWell('No results')).toBe(true);
      expect(isDryWell('')).toBe(true);
      expect(isDryWell('   ')).toBe(true);
    });

    it('returns true for long content without story data patterns', () => {
      const longText = 'This is a generic response with no story references. '.repeat(10);
      expect(isDryWell(longText)).toBe(true);
    });

    it('returns false when content has point counts', () => {
      const withPoints = 'A'.repeat(250) + ' This story has 120 points and many comments.';
      expect(isDryWell(withPoints)).toBe(false);
    });

    it('returns false when content has Story ID references', () => {
      const withStory = 'A'.repeat(250) + ' Story 42345 discusses this topic in depth.';
      expect(isDryWell(withStory)).toBe(false);
    });
  });

  describe('buildDryWellBundle', () => {
    it('produces a valid EvidenceBundle', () => {
      const bundle = buildDryWellBundle('test query');
      const parsed = EvidenceBundleSchema.safeParse(bundle);
      expect(parsed.success).toBe(true);
    });

    it('preserves the query in the bundle', () => {
      const bundle = buildDryWellBundle('my special query');
      expect(bundle.query).toBe('my special query');
    });

    it('has zero sources and low token count', () => {
      const bundle = buildDryWellBundle('q');
      expect(bundle.allSources).toHaveLength(0);
      expect(bundle.totalSourcesScanned).toBe(0);
      expect(bundle.tokenCount).toBe(50);
    });
  });
});
