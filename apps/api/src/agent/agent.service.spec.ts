import { Test, TestingModule } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import { createAgent } from 'langchain';
import { AGENT_SYSTEM_PROMPT } from './system-prompt';
import type { AgentResponse } from '@voxpopuli/shared-types';

// ---------------------------------------------------------------------------
// Mock the langchain module
// ---------------------------------------------------------------------------

jest.mock('langchain', () => ({
  createAgent: jest.fn(),
}));

jest.mock('./tools', () => ({
  createAgentTools: jest.fn(() => []),
}));

// Mock LLM providers to avoid loading @langchain/* ESM packages
jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock async iterable that yields the given events.
 * Each event should have a `messages` array mimicking LangChain stream output.
 */
function createMockStream(events: Array<{ messages: unknown[] }>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

/** Build a fake AI message object (final answer with no tool calls). */
function fakeAIMessage(content: string) {
  return {
    content,
    tool_calls: [],
    _getType: () => 'ai',
    constructor: { name: 'AIMessage' },
  };
}

/** Build a fake tool message object (observation from tool). */
function fakeToolMessage(content: string, toolName: string) {
  return {
    content,
    name: toolName,
    _getType: () => 'tool',
    constructor: { name: 'ToolMessage' },
  };
}

/** Build a fake AI message with tool calls (action step). */
function fakeToolCallMessage(toolName: string, args: Record<string, unknown>) {
  return {
    content: '',
    tool_calls: [{ name: toolName, args }],
    _getType: () => 'ai',
    constructor: { name: 'AIMessage' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentService', () => {
  let service: AgentService;
  let llmService: LlmService;

  const mockModel = { name: 'mock-model' };

  const mockLlmService = {
    getModel: jest.fn().mockReturnValue(mockModel),
    getProviderName: jest.fn().mockReturnValue('groq'),
    getMaxContextTokens: jest.fn().mockReturnValue(50000),
  };

  const mockHnService = {
    search: jest.fn(),
    searchByDate: jest.fn(),
    getItem: jest.fn(),
    getCommentTree: jest.fn(),
  };

  const mockChunkerService = {
    chunkStories: jest.fn(),
    chunkComments: jest.fn(),
    buildContext: jest.fn(),
    formatForPrompt: jest.fn(),
    estimateTokens: jest.fn(),
    stripHtml: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: LlmService, useValue: mockLlmService },
        { provide: HnService, useValue: mockHnService },
        { provide: ChunkerService, useValue: mockChunkerService },
      ],
    }).compile();

    service = module.get<AgentService>(AgentService);
    llmService = module.get<LlmService>(LlmService);
  });

  // -------------------------------------------------------------------------
  // 1. should create an agent and return AgentResponse
  // -------------------------------------------------------------------------
  it('should create an agent and return AgentResponse', async () => {
    const mockStream = createMockStream([
      { messages: [fakeAIMessage('This is the answer about Rust on HN.')] },
    ]);

    (createAgent as jest.Mock).mockReturnValue({
      stream: jest.fn().mockResolvedValue(mockStream),
    });

    const result: AgentResponse = await service.run('What does HN think about Rust?');

    // Verify createAgent was called with expected arguments
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        tools: expect.any(Array),
        systemPrompt: expect.any(String),
      }),
    );

    // Verify response shape
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('steps');
    expect(result).toHaveProperty('sources');
    expect(result).toHaveProperty('trust');
    expect(result).toHaveProperty('meta');

    // Verify answer content
    expect(result.answer).toBe('This is the answer about Rust on HN.');

    // Verify meta fields
    expect(result.meta.provider).toBe('groq');
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.meta.cached).toBe(false);

    // Verify trust metadata is present
    expect(result.trust).toHaveProperty('sourcesVerified');
    expect(result.trust).toHaveProperty('sourcesTotal');
    expect(result.trust).toHaveProperty('viewpointDiversity');
    expect(result.trust).toHaveProperty('honestyFlags');
  });

  // -------------------------------------------------------------------------
  // 2. should respect max concurrent runs
  // -------------------------------------------------------------------------
  it('should respect max concurrent runs', async () => {
    // Set activeConcurrent to MAX_CONCURRENT (5) via reflection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).activeConcurrent = 5;

    await expect(service.run('test query')).rejects.toThrow(
      'Too many concurrent agent runs. Please try again later.',
    );
  });

  // -------------------------------------------------------------------------
  // 3. should decrement concurrent counter on completion
  // -------------------------------------------------------------------------
  it('should decrement concurrent counter on completion', async () => {
    const mockStream = createMockStream([{ messages: [fakeAIMessage('Done.')] }]);

    (createAgent as jest.Mock).mockReturnValue({
      stream: jest.fn().mockResolvedValue(mockStream),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).activeConcurrent = 0;

    await service.run('test query');

    // After completion, counter should be back to 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).activeConcurrent).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. should decrement concurrent counter on error
  // -------------------------------------------------------------------------
  it('should decrement concurrent counter on error', async () => {
    (createAgent as jest.Mock).mockReturnValue({
      stream: jest.fn().mockRejectedValue(new Error('LLM provider failed')),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).activeConcurrent = 0;

    await expect(service.run('test query')).rejects.toThrow('LLM provider failed');

    // Counter should still decrement back to 0 after error
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).activeConcurrent).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5. should replace maxSteps placeholder in system prompt
  // -------------------------------------------------------------------------
  it('should replace maxSteps placeholder in system prompt', async () => {
    const mockStream = createMockStream([{ messages: [fakeAIMessage('answer')] }]);

    (createAgent as jest.Mock).mockReturnValue({
      stream: jest.fn().mockResolvedValue(mockStream),
    });

    await service.run('test query');

    // Verify the system prompt had {{maxSteps}} replaced with the actual number
    const callArgs = (createAgent as jest.Mock).mock.calls[0][0];
    expect(callArgs.systemPrompt).not.toContain('{{maxSteps}}');
    expect(callArgs.systemPrompt).toContain('7'); // MAX_STEPS = 7

    // Verify it matches the expected replaced prompt
    const expectedPrompt = AGENT_SYSTEM_PROMPT.replace('{{maxSteps}}', '7');
    expect(callArgs.systemPrompt).toBe(expectedPrompt);
  });

  // -------------------------------------------------------------------------
  // 6. should extract sources from tool output
  // -------------------------------------------------------------------------
  it('should extract sources from tool output', async () => {
    const toolOutput =
      '[12345] "Show HN: My Cool Project" by rustdev (150 points, 42 comments)\n' +
      '[67890] "Ask HN: Best Rust frameworks?" by godev (200 points, 88 comments)';

    const mockStream = createMockStream([
      // Tool call action
      { messages: [fakeToolCallMessage('search_hn', { query: 'rust' })] },
      // Tool result observation containing source patterns
      { messages: [fakeToolMessage(toolOutput, 'search_hn')] },
      // Final AI answer referencing the sources
      { messages: [fakeAIMessage('Based on HN discussions, Rust is popular.')] },
    ]);

    (createAgent as jest.Mock).mockReturnValue({
      stream: jest.fn().mockResolvedValue(mockStream),
    });

    const result = await service.run('What does HN think about Rust?');

    // Verify sources were extracted from the tool output
    expect(result.sources).toHaveLength(2);

    const source1 = result.sources.find((s) => s.storyId === 12345);
    expect(source1).toBeDefined();
    expect(source1!.title).toBe('Show HN: My Cool Project');
    expect(source1!.author).toBe('rustdev');
    expect(source1!.points).toBe(150);

    const source2 = result.sources.find((s) => s.storyId === 67890);
    expect(source2).toBeDefined();
    expect(source2!.title).toBe('Ask HN: Best Rust frameworks?');
    expect(source2!.author).toBe('godev');
    expect(source2!.points).toBe(200);

    // Verify steps captured both tool call and observation
    const actionSteps = result.steps.filter((s) => s.type === 'action');
    const observationSteps = result.steps.filter((s) => s.type === 'observation');
    expect(actionSteps.length).toBeGreaterThanOrEqual(1);
    expect(observationSteps.length).toBeGreaterThanOrEqual(1);
    expect(actionSteps[0].toolName).toBe('search_hn');
  });
});
