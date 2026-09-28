import { EvidenceBundleSchema } from '@voxpopuli/shared-types';

// Mock @langchain/langgraph before importing the node
const mockReactAgentStream = jest.fn();
jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(() => ({
    stream: mockReactAgentStream,
  })),
}));

// Mock LLM providers
jest.mock('../../llm/providers/openrouter.provider', () => ({ OpenRouterProvider: jest.fn() }));
jest.mock('../../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

import { ChunkerService } from '../../chunker/chunker.service';
import {
  summarizeToolOutput,
  createRetrieverNode,
  isDryWell,
  buildDryWellBundle,
  type RetrieverResult,
} from './retriever.node';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

/** Helper: realistic raw data that passes the dry-well check. */
const RICH_RAW_DATA =
  'Story 12345 — How Rust is changing systems programming. ' +
  'Posted by alice. 245 points, 89 comments. ' +
  'Top comments discuss memory safety vs C++. ' +
  'Several users report switching production services to Rust with good results. ' +
  'Some dissent about the learning curve being too steep for small teams.';

/**
 * Helper: wrap messages in an async iterable that mimics reactAgent.stream()
 * with streamMode: 'values'. Yields a single chunk with all messages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockStreamResult(messages: any[]) {
  async function* generate() {
    yield { messages };
  }
  return generate();
}

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

  it('should produce a valid EvidenceBundle and steps array', async () => {
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

    mockReactAgentStream.mockReturnValue(
      mockStreamResult([{ content: RICH_RAW_DATA, role: 'assistant' }]),
    );

    mockModel.invoke.mockResolvedValue({ content: bundleJson });

    const node = createRetrieverNode(mockModel, mockTools);
    const result: RetrieverResult = await node({ query: 'test query' });

    expect(result.bundle).toBeDefined();
    expect(result.steps).toBeDefined();
    expect(Array.isArray(result.steps)).toBe(true);
    const parsed = EvidenceBundleSchema.safeParse(result.bundle);
    expect(parsed.success).toBe(true);
  });

  it('should retry compaction on invalid JSON', async () => {
    mockReactAgentStream.mockReturnValue(
      mockStreamResult([{ content: RICH_RAW_DATA, role: 'assistant' }]),
    );

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

  it('should accumulate steps from ReAct streaming into steps array', async () => {
    const bundleJson = JSON.stringify({
      query: 'test',
      themes: [
        { label: 'T', items: [{ sourceId: 1, text: 'x', type: 'evidence', relevance: 0.5 }] },
      ],
      allSources: [{ storyId: 1, title: 'S', url: '', author: 'a', points: 1, commentCount: 0 }],
      totalSourcesScanned: 1,
      tokenCount: 100,
    });

    // Simulate messages with _getType() for step extraction
    const aiMsg = {
      content: 'Let me search for this topic',
      _getType: () => 'ai',
      tool_calls: [{ name: 'search_hn', args: { query: 'test' } }],
    };
    const toolMsg = {
      content: 'Found 3 stories about test topic. Story 1234 — 50 points.',
      _getType: () => 'tool',
    };
    const thoughtMsg = {
      content: 'The search returned useful results',
      _getType: () => 'ai',
    };

    mockReactAgentStream.mockReturnValue(mockStreamResult([aiMsg, toolMsg, thoughtMsg]));
    mockModel.invoke.mockResolvedValue({ content: bundleJson });

    const node = createRetrieverNode(mockModel, mockTools);
    const result = await node({ query: 'test' });

    expect(result.bundle).toBeDefined();
    expect(result.steps).toBeDefined();
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    // Should have an action step (from the tool_call), an observation step, and a thought step
    const actionStep = result.steps.find((s) => s.type === 'action');
    expect(actionStep).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(actionStep!.toolName).toBe('search_hn');
    const observationStep = result.steps.find((s) => s.type === 'observation');
    expect(observationStep).toBeDefined();
    const thoughtStep = result.steps.find((s) => s.type === 'thought');
    expect(thoughtStep).toBeDefined();
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

    mockReactAgentStream.mockReturnValue(
      mockStreamResult([{ content: RICH_RAW_DATA, role: 'assistant' }]),
    );
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
    mockReactAgentStream.mockReturnValue(
      mockStreamResult([{ content: RICH_RAW_DATA, role: 'assistant' }]),
    );

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
    mockReactAgentStream.mockReturnValue(
      mockStreamResult([
        { content: longContent, role: 'assistant' },
        { content: longContent, role: 'assistant' },
      ]),
    );

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

    mockReactAgentStream.mockReturnValue(
      mockStreamResult([{ content: RICH_RAW_DATA, role: 'assistant' }]),
    );
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

    // Verify the ReAct agent was streamed with the query as a HumanMessage
    expect(mockReactAgentStream).toHaveBeenCalledTimes(1);
    const streamArgs = mockReactAgentStream.mock.calls[0][0];
    expect(streamArgs.messages).toHaveLength(1);
    expect(streamArgs.messages[0].content).toBe('what is new in AI');

    // Verify the result is a valid EvidenceBundle
    expect(result.bundle).toBeDefined();
    const parsed = EvidenceBundleSchema.safeParse(result.bundle);
    expect(parsed.success).toBe(true);
  });

  describe('dry-well circuit breaker', () => {
    it('should skip compaction and return dry-well bundle when raw data is sparse', async () => {
      mockReactAgentStream.mockReturnValue(
        mockStreamResult([{ content: 'No results found for this query.', role: 'assistant' }]),
      );

      const node = createRetrieverNode(mockModel, mockTools);
      const result = await node({ query: 'obscure topic nobody discussed' });

      // Compaction LLM call should NOT have been made
      expect(mockModel.invoke).not.toHaveBeenCalled();

      // Bundle should be a valid EvidenceBundle
      const parsed = EvidenceBundleSchema.safeParse(result.bundle);
      expect(parsed.success).toBe(true);

      // Steps array should still be present (may be empty or contain steps from ReAct)
      expect(result.steps).toBeDefined();
      expect(Array.isArray(result.steps)).toBe(true);

      // Bundle should contain the dry-well placeholder theme
      expect(result.bundle.themes).toHaveLength(1);
      expect(result.bundle.themes[0].label).toBe('No substantial discussion found');
      expect(result.bundle.allSources).toHaveLength(0);
      expect(result.bundle.totalSourcesScanned).toBe(0);
      expect(result.bundle.query).toBe('obscure topic nobody discussed');
    });

    it('should proceed with compaction when raw data has story content', async () => {
      mockReactAgentStream.mockReturnValue(
        mockStreamResult([{ content: RICH_RAW_DATA, role: 'assistant' }]),
      );

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

  describe('latency safeguards', () => {
    const themesJson = JSON.stringify({
      themes: [
        { label: 'T', items: [{ sourceId: 7, text: 'x', type: 'evidence', relevance: 0.5 }] },
      ],
    });
    const registeredSource = {
      storyId: 7,
      title: 'Ask HN: Rust?',
      url: 'https://news.ycombinator.com/item?id=7',
      author: 'a',
      points: 12,
      commentCount: 3,
    };

    it('builds allSources from the tool registry, not from LLM output', async () => {
      mockReactAgentStream.mockReturnValue(
        mockStreamResult([{ content: RICH_RAW_DATA, role: 'assistant' }]),
      );
      // Even if the model still emits a (broken) source table, it is ignored.
      mockModel.invoke.mockResolvedValue({
        content: JSON.stringify({ ...JSON.parse(themesJson), allSources: [{ url: null }] }),
      });

      const sources = new Map([[7, registeredSource]]);
      const node = createRetrieverNode(mockModel, mockTools, sources);
      const { bundle } = await node({ query: 'rust' });

      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
      expect(bundle.allSources).toEqual([registeredSource]);
      expect(bundle.totalSourcesScanned).toBe(1);
      expect(EvidenceBundleSchema.safeParse(bundle).success).toBe(true);
    });

    it('compacts collected evidence instead of failing when the tool budget runs out', async () => {
      const { GraphRecursionError } = jest.requireActual('@langchain/langgraph');
      mockReactAgentStream.mockReturnValue(
        (async function* () {
          yield { messages: [{ content: RICH_RAW_DATA, role: 'assistant' }] };
          throw new GraphRecursionError('Recursion limit of 17 reached');
        })(),
      );
      mockModel.invoke.mockResolvedValue({ content: themesJson });

      const node = createRetrieverNode(mockModel, mockTools, new Map([[7, registeredSource]]));
      const { bundle } = await node({ query: 'rust' });

      expect(bundle.themes).toHaveLength(1);
      expect(bundle.allSources).toEqual([registeredSource]);
    });

    it('still surfaces unexpected ReAct errors', async () => {
      mockReactAgentStream.mockReturnValue(
        (async function* () {
          yield { messages: [] };
          throw new Error('401 Invalid API Key');
        })(),
      );

      const node = createRetrieverNode(mockModel, mockTools);
      await expect(node({ query: 'rust' })).rejects.toThrow('401 Invalid API Key');
    });

    it('runs the ReAct loop on the (token-capped) react model and compacts with the main model', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reactModel = { invoke: jest.fn() } as any;
      mockReactAgentStream.mockReturnValue(
        mockStreamResult([{ content: RICH_RAW_DATA, role: 'assistant' }]),
      );
      mockModel.invoke.mockResolvedValue({ content: themesJson });

      const node = createRetrieverNode(mockModel, mockTools, new Map(), reactModel);
      await node({ query: 'rust' });

      expect(jest.mocked(createReactAgent)).toHaveBeenLastCalledWith(
        expect.objectContaining({ llm: reactModel }),
      );
      expect(reactModel.invoke).not.toHaveBeenCalled();
      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
    });
  });
});

describe('summarizeToolOutput', () => {
  it('counts comments in the real get_comments output format', () => {
    // Generate the observation exactly as the get_comments tool does, so a format
    // change on either side breaks this test instead of silently showing "No comment content".
    const chunker = new ChunkerService();
    const comments = chunker.chunkComments([
      { id: 1, type: 'comment', by: 'alice', time: 0, text: 'Great tool', parent: 9, depth: 0 },
      {
        id: 2,
        type: 'comment',
        by: 'bob',
        time: 0,
        text: 'Line one\nline two',
        parent: 1,
        depth: 1,
      },
      { id: 3, type: 'comment', by: 'carol', time: 0, text: 'Agreed', parent: 9, depth: 0 },
    ]);
    const raw = chunker.formatForPrompt(chunker.buildContext([], comments, Infinity));

    expect(summarizeToolOutput('get_comments', raw)).toBe('Read 3 comments');
  });

  it('reports genuinely empty comment results', () => {
    expect(summarizeToolOutput('get_comments', 'No comments found for story 9.')).toBe(
      'No comments found',
    );
  });
});
