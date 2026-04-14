import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { lastValueFrom, toArray } from 'rxjs';
import type { AgentResponse, AgentStep } from '@voxpopuli/shared-types';
import { RagController } from './rag.controller';
import { AgentService } from '../agent/agent.service';
import { OrchestratorService } from '../agent/orchestrator.service';
import { CacheService } from '../cache/cache.service';
import { QueryStore } from '../cache/query-store';

// Mock LLM providers to avoid loading @langchain/* ESM packages
jest.mock('../agent/../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../agent/../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../agent/../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));
jest.mock('langchain', () => ({ createAgent: jest.fn() }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake AgentStep. */
function fakeStep(type: AgentStep['type'], content: string): AgentStep {
  return {
    type,
    content,
    toolName: type === 'action' ? 'searchHn' : undefined,
    toolInput: type === 'action' ? { query: 'test' } : undefined,
    timestamp: Date.now(),
  };
}

/** Build a fake AgentResponse with a mix of step types. */
function fakeAgentResponse(answer = 'Test answer'): AgentResponse {
  return {
    answer,
    steps: [
      fakeStep('thought', 'Thinking about the query'),
      fakeStep('action', 'Searching HN'),
      fakeStep('observation', 'Found 3 results'),
    ],
    sources: [
      {
        storyId: 1,
        title: 'Test Story',
        url: 'https://example.com',
        author: 'testuser',
        points: 100,
        commentCount: 10,
      },
    ],
    meta: {
      provider: 'groq',
      totalInputTokens: 500,
      totalOutputTokens: 200,
      durationMs: 1234,
      cached: false,
    },
    trust: {
      sourcesVerified: 1,
      sourcesTotal: 1,
      avgSourceAge: 5,
      recentSourceRatio: 0.8,
      viewpointDiversity: 'balanced',
      showHnCount: 0,
      honestyFlags: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Create a mock async generator that yields the given events.
 */
async function* mockRunStream(
  events: Array<{ kind: string; step?: AgentStep; response?: AgentResponse }>,
) {
  for (const event of events) {
    yield event;
  }
}

describe('RagController', () => {
  let controller: RagController;
  let agentService: { run: jest.Mock; runStream: jest.Mock };
  let orchestratorService: { runWithFallback: jest.Mock };
  let cacheService: { getOrSet: jest.Mock };
  let queryStore: {
    create: jest.Mock;
    get: jest.Mock;
    appendEvent: jest.Mock;
    appendStep: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
    findRunning: jest.Mock;
  };

  beforeEach(async () => {
    agentService = { run: jest.fn(), runStream: jest.fn() };
    orchestratorService = { runWithFallback: jest.fn() };
    cacheService = { getOrSet: jest.fn() };
    queryStore = {
      create: jest.fn().mockReturnValue('test-query-id'),
      get: jest.fn(),
      appendEvent: jest.fn(),
      appendStep: jest.fn(),
      complete: jest.fn(),
      fail: jest.fn(),
      findRunning: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RagController],
      providers: [
        { provide: AgentService, useValue: agentService },
        { provide: OrchestratorService, useValue: orchestratorService },
        { provide: CacheService, useValue: cacheService },
        { provide: QueryStore, useValue: queryStore },
      ],
    }).compile();

    controller = module.get<RagController>(RagController);
  });

  // -------------------------------------------------------------------------
  // 1. POST /query should return AgentResponse
  // -------------------------------------------------------------------------
  it('POST /query should return AgentResponse', async () => {
    const expected = fakeAgentResponse();

    // getOrSet calls the factory function, simulating a cache miss
    cacheService.getOrSet.mockImplementation(
      (_key: string, factory: () => Promise<AgentResponse>) => factory(),
    );
    agentService.run.mockResolvedValue(expected);

    const result = await controller.query({ query: 'What is Rust?' });

    expect(result).toEqual(expected);
    expect(agentService.run).toHaveBeenCalledWith('What is Rust?', {
      maxSteps: undefined,
      provider: undefined,
    });
    expect(cacheService.getOrSet).toHaveBeenCalledWith(
      'rag:query:What is Rust?:false',
      expect.any(Function),
      600,
    );
  });

  // -------------------------------------------------------------------------
  // 2. POST /query should use cached results
  // -------------------------------------------------------------------------
  it('POST /query should use cached results', async () => {
    const cached = fakeAgentResponse('Cached answer');

    // getOrSet returns the cached value directly without calling factory
    cacheService.getOrSet.mockResolvedValue(cached);

    const result = await controller.query({ query: 'cached query' });

    expect(result).toEqual(cached);
    expect(agentService.run).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. GET /stream should emit SSE events from runStream generator
  // -------------------------------------------------------------------------
  it('GET /stream should emit SSE events for each step and a final answer', async () => {
    const response = fakeAgentResponse();
    const steps = response.steps;

    // Mock runStream to yield step events then a complete event
    agentService.runStream.mockReturnValue(
      mockRunStream([
        { kind: 'step', step: steps[0] },
        { kind: 'step', step: steps[1] },
        { kind: 'step', step: steps[2] },
        { kind: 'complete', response },
      ]),
    );

    const observable = controller.stream('What is Rust?');

    // Collect all emitted events
    const events = await lastValueFrom(observable.pipe(toArray()));

    // 1 init + 3 steps + 1 answer = 5 events
    expect(events).toHaveLength(5);

    // First event is init with queryId
    expect(events[0].type).toBe('init');
    expect(JSON.parse(events[0].data as string).queryId).toBe('test-query-id');

    // Verify step events
    expect(events[1].type).toBe('thought');
    expect(JSON.parse(events[1].data as string).content).toBe('Thinking about the query');

    expect(events[2].type).toBe('action');
    expect(JSON.parse(events[2].data as string).toolName).toBe('searchHn');

    expect(events[3].type).toBe('observation');
    expect(JSON.parse(events[3].data as string).content).toBe('Found 3 results');

    // Verify final answer event
    expect(events[4].type).toBe('answer');
    const answerData = JSON.parse(events[4].data as string);
    expect(answerData.answer).toBe('Test answer');
    expect(answerData.sources).toHaveLength(1);
    expect(answerData.trust).toBeDefined();
    expect(answerData.meta).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 4. GET /stream should emit error event on failure
  // -------------------------------------------------------------------------
  it('GET /stream should emit error event on failure', async () => {
    // Mock runStream to throw an error
    agentService.runStream.mockReturnValue(
      // eslint-disable-next-line require-yield
      (async function* () {
        throw new Error('LLM provider timeout');
      })(),
    );

    const observable = controller.stream('failing query');
    const events = await lastValueFrom(observable.pipe(toArray()));

    // 1 init + 1 error = 2 events
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('init');
    expect(events[1].type).toBe('error');
    expect(JSON.parse(events[1].data as string).message).toBe('LLM provider timeout');
    expect(queryStore.fail).toHaveBeenCalledWith('test-query-id', 'LLM provider timeout');
  });

  // -------------------------------------------------------------------------
  // 5. GET /stream should reject empty query
  // -------------------------------------------------------------------------
  it('GET /stream should reject empty query', () => {
    expect(() => controller.stream('')).toThrow(HttpException);

    try {
      controller.stream('');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    }
  });

  // -------------------------------------------------------------------------
  // 6. GET /stream should reject query over 500 chars
  // -------------------------------------------------------------------------
  it('GET /stream should reject query over 500 chars', () => {
    const longQuery = 'a'.repeat(501);

    expect(() => controller.stream(longQuery)).toThrow(HttpException);

    try {
      controller.stream(longQuery);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    }
  });

  // -------------------------------------------------------------------------
  // 7. should enforce rate limit after 60 requests
  // -------------------------------------------------------------------------
  it('should enforce rate limit after 60 requests', async () => {
    const response = fakeAgentResponse();

    cacheService.getOrSet.mockImplementation(
      (_key: string, factory: () => Promise<AgentResponse>) => factory(),
    );
    agentService.run.mockResolvedValue(response);

    // Make 60 successful requests (the rate limit)
    for (let i = 0; i < 60; i++) {
      await controller.query({ query: `query-${i}` });
    }

    // The 61st request should throw 429
    try {
      await controller.query({ query: 'one-too-many' });
      fail('Expected HttpException to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((err as HttpException).message).toContain('Rate limit exceeded');
    }
  });

  // -------------------------------------------------------------------------
  // 8. POST /query with useMultiAgent should route through orchestrator
  // -------------------------------------------------------------------------
  it('POST /query with useMultiAgent should route through orchestrator pipeline', async () => {
    const expected = fakeAgentResponse('Pipeline answer');

    cacheService.getOrSet.mockImplementation(
      (_key: string, factory: () => Promise<AgentResponse>) => factory(),
    );

    // Mock the orchestrator to yield a complete event
    orchestratorService.runWithFallback.mockReturnValue(
      (async function* () {
        yield { kind: 'complete', response: expected };
      })(),
    );

    const result = await controller.query({
      query: 'Pipeline test',
      useMultiAgent: true,
    });

    expect(result).toEqual(expected);
    expect(agentService.run).not.toHaveBeenCalled();
    expect(orchestratorService.runWithFallback).toHaveBeenCalled();
    expect(cacheService.getOrSet).toHaveBeenCalledWith(
      'rag:query:Pipeline test:true',
      expect.any(Function),
      600,
    );
  });

  // -------------------------------------------------------------------------
  // 9. POST /query with provider should pass provider to agent.run
  // -------------------------------------------------------------------------
  it('POST /query with provider should pass provider to agent.run', async () => {
    const expected = fakeAgentResponse();

    cacheService.getOrSet.mockImplementation(
      (_key: string, factory: () => Promise<AgentResponse>) => factory(),
    );
    agentService.run.mockResolvedValue(expected);

    await controller.query({ query: 'test', provider: 'mistral' });

    expect(agentService.run).toHaveBeenCalledWith('test', {
      maxSteps: undefined,
      provider: 'mistral',
    });
  });

  // -------------------------------------------------------------------------
  // 10. GET /stream with useMultiAgent should emit pipeline events
  // -------------------------------------------------------------------------
  it('GET /stream with useMultiAgent should emit init/pipeline/step/token/answer events', async () => {
    const response = fakeAgentResponse('Multi-agent answer');
    const step = fakeStep('thought', 'Pipeline thinking');

    orchestratorService.runWithFallback.mockReturnValue(
      (async function* () {
        yield { kind: 'pipeline', event: { stage: 'retriever', status: 'running' } };
        yield { kind: 'step', step };
        yield { kind: 'token', content: 'partial ' };
        yield { kind: 'complete', response };
      })(),
    );

    const observable = controller.stream('multi-agent query', undefined, 'true');
    const events = await lastValueFrom(observable.pipe(toArray()));

    // 1 init + 4 events = 5
    expect(events).toHaveLength(5);

    // Init event
    expect(events[0].type).toBe('init');
    expect(JSON.parse(events[0].data as string).queryId).toBe('test-query-id');

    // Pipeline event
    expect(events[1].type).toBe('pipeline');
    expect(JSON.parse(events[1].data as string)).toEqual({
      stage: 'retriever',
      status: 'running',
    });

    // Step event
    expect(events[2].type).toBe('thought');
    expect(JSON.parse(events[2].data as string).content).toBe('Pipeline thinking');

    // Token event
    expect(events[3].type).toBe('token');
    expect(JSON.parse(events[3].data as string).content).toBe('partial ');

    // Answer event
    expect(events[4].type).toBe('answer');
    const answerData = JSON.parse(events[4].data as string);
    expect(answerData.answer).toBe('Multi-agent answer');

    // Verify QueryStore interactions
    expect(queryStore.create).toHaveBeenCalledWith('multi-agent query', 'default');
    expect(queryStore.appendEvent).toHaveBeenCalled();
    expect(queryStore.appendStep).toHaveBeenCalled();
    expect(queryStore.complete).toHaveBeenCalledWith('test-query-id', response);
  });

  // -------------------------------------------------------------------------
  // 11. GET /stream multi-agent error handling
  // -------------------------------------------------------------------------
  it('GET /stream multi-agent should emit error event on pipeline failure', async () => {
    orchestratorService.runWithFallback.mockReturnValue(
      // eslint-disable-next-line require-yield
      (async function* () {
        throw new Error('Pipeline stage failed');
      })(),
    );

    const observable = controller.stream('failing pipeline', undefined, 'true');
    const events = await lastValueFrom(observable.pipe(toArray()));

    // 1 init + 1 error = 2 events
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('init');
    expect(events[1].type).toBe('error');
    expect(JSON.parse(events[1].data as string).message).toBe('Pipeline stage failed');
    expect(queryStore.fail).toHaveBeenCalledWith('test-query-id', 'Pipeline stage failed');
  });

  // -------------------------------------------------------------------------
  // 12. SSE events should have incrementing IDs
  // -------------------------------------------------------------------------
  it('SSE events should have incrementing IDs', async () => {
    const response = fakeAgentResponse();

    agentService.runStream.mockReturnValue(
      mockRunStream([
        { kind: 'step', step: response.steps[0] },
        { kind: 'step', step: response.steps[1] },
        { kind: 'complete', response },
      ]),
    );

    const observable = controller.stream('test query');
    const events = await lastValueFrom(observable.pipe(toArray()));

    // init=1, step=2, step=3, answer=4
    expect(events[0].id).toBe('1');
    expect(events[1].id).toBe('2');
    expect(events[2].id).toBe('3');
    expect(events[3].id).toBe('4');
  });

  // -------------------------------------------------------------------------
  // 13. SSE first event should include retry directive
  // -------------------------------------------------------------------------
  it('SSE first event (init) should include retry directive', async () => {
    const response = fakeAgentResponse();

    agentService.runStream.mockReturnValue(
      mockRunStream([
        { kind: 'step', step: response.steps[0] },
        { kind: 'complete', response },
      ]),
    );

    const observable = controller.stream('test query');
    const events = await lastValueFrom(observable.pipe(toArray()));

    // Init event (first) should have retry set to 5000ms
    expect(events[0].type).toBe('init');
    expect((events[0] as unknown as Record<string, unknown>).retry).toBe(5_000);
    // Subsequent events should NOT have retry
    expect((events[1] as unknown as Record<string, unknown>).retry).toBeUndefined();
    expect((events[2] as unknown as Record<string, unknown>).retry).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 14. Pipeline completing without response should throw 500
  // -------------------------------------------------------------------------
  it('POST /query with useMultiAgent should throw 500 when pipeline yields no complete event', async () => {
    cacheService.getOrSet.mockImplementation(
      (_key: string, factory: () => Promise<AgentResponse>) => factory(),
    );

    // Mock orchestrator that yields pipeline events but never a complete event
    orchestratorService.runWithFallback.mockReturnValue(
      (async function* () {
        yield { kind: 'pipeline', event: { stage: 'retriever', status: 'running' } };
        yield { kind: 'pipeline', event: { stage: 'retriever', status: 'done' } };
        // No 'complete' event
      })(),
    );

    await expect(controller.query({ query: 'no-response', useMultiAgent: true })).rejects.toThrow(
      HttpException,
    );

    try {
      await controller.query({ query: 'no-response-2', useMultiAgent: true });
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    }
  });

  // -------------------------------------------------------------------------
  // 15. POST /query useMultiAgent with provider should pass provider to pipeline
  // -------------------------------------------------------------------------
  it('POST /query useMultiAgent with provider should configure pipeline providerMap', async () => {
    const expected = fakeAgentResponse();

    cacheService.getOrSet.mockImplementation(
      (_key: string, factory: () => Promise<AgentResponse>) => factory(),
    );

    orchestratorService.runWithFallback.mockReturnValue(
      (async function* () {
        yield { kind: 'complete', response: expected };
      })(),
    );

    await controller.query({
      query: 'provider test',
      useMultiAgent: true,
      provider: 'claude',
    });

    // Verify that orchestrator was called with a config containing providerMap
    expect(orchestratorService.runWithFallback).toHaveBeenCalledWith(
      'provider test',
      expect.objectContaining({
        providerMap: expect.objectContaining({
          retriever: 'claude',
          synthesizer: 'claude',
          writer: 'claude',
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 16. Multi-agent SSE events should have incrementing IDs
  // -------------------------------------------------------------------------
  it('multi-agent SSE events should have incrementing IDs', async () => {
    const response = fakeAgentResponse();

    orchestratorService.runWithFallback.mockReturnValue(
      (async function* () {
        yield { kind: 'pipeline', event: { stage: 'retriever', status: 'running' } };
        yield { kind: 'complete', response };
      })(),
    );

    const observable = controller.stream('test', undefined, 'true');
    const events = await lastValueFrom(observable.pipe(toArray()));

    // init=1, pipeline=2, answer=3
    expect(events[0].id).toBe('1');
    expect(events[1].id).toBe('2');
    expect(events[2].id).toBe('3');
  });

  // -------------------------------------------------------------------------
  // 17. Multi-agent SSE first event should include retry directive
  // -------------------------------------------------------------------------
  it('multi-agent SSE first event (init) should include retry directive', async () => {
    const response = fakeAgentResponse();

    orchestratorService.runWithFallback.mockReturnValue(
      (async function* () {
        yield { kind: 'pipeline', event: { stage: 'retriever', status: 'running' } };
        yield { kind: 'complete', response };
      })(),
    );

    const observable = controller.stream('test', undefined, 'true');
    const events = await lastValueFrom(observable.pipe(toArray()));

    // Init event (first) should have retry
    expect(events[0].type).toBe('init');
    expect((events[0] as unknown as Record<string, unknown>).retry).toBe(5_000);
    // Subsequent events should NOT have retry
    expect((events[1] as unknown as Record<string, unknown>).retry).toBeUndefined();
    expect((events[2] as unknown as Record<string, unknown>).retry).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 18. GET /query/:id/result returns 200 for completed query
  // -------------------------------------------------------------------------
  it('GET /query/:id/result should return completed QueryResult', () => {
    const result = {
      queryId: 'abc-123',
      status: 'complete' as const,
      response: fakeAgentResponse(),
      pipelineEvents: [],
      steps: [],
      error: null,
      createdAt: Date.now(),
      completedAt: Date.now(),
    };
    queryStore.get.mockReturnValue(result);

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as import('express').Response;
    controller.getResult('abc-123', res);
    expect(queryStore.get).toHaveBeenCalledWith('abc-123');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(result);
  });

  // -------------------------------------------------------------------------
  // 19. GET /query/:id/result returns 404 for missing query
  // -------------------------------------------------------------------------
  it('GET /query/:id/result should throw 404 for unknown queryId', () => {
    queryStore.get.mockReturnValue(undefined);
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as import('express').Response;

    try {
      controller.getResult('nonexistent', res);
      fail('Expected HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });

  // -------------------------------------------------------------------------
  // 20. GET /query/:id/result returns 202 for running query
  // -------------------------------------------------------------------------
  it('GET /query/:id/result should return 202 for running query with partial data', () => {
    const result = {
      queryId: 'running-123',
      status: 'running' as const,
      response: null,
      pipelineEvents: [{ stage: 'retriever', status: 'running' }],
      steps: [fakeStep('thought', 'Thinking...')],
      error: null,
      createdAt: Date.now(),
      completedAt: null,
    };
    queryStore.get.mockReturnValue(result);

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as import('express').Response;
    controller.getResult('running-123', res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        queryId: 'running-123',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 21. Duplicate in-flight query should poll existing result (legacy)
  // -------------------------------------------------------------------------
  it('legacy stream should return existing query result when duplicate is in-flight', async () => {
    const response = fakeAgentResponse('Deduped answer');
    const existingQueryId = 'existing-query-id';

    // findRunning returns existing queryId for this query+provider
    queryStore.findRunning.mockReturnValue(existingQueryId);

    // First call returns running, second returns complete
    queryStore.get.mockReturnValueOnce({
      queryId: existingQueryId,
      status: 'complete',
      response,
      pipelineEvents: [],
      steps: [fakeStep('thought', 'Already thinking')],
      error: null,
      createdAt: Date.now(),
      completedAt: Date.now(),
    });

    const observable = controller.stream('What is Rust?');
    const events = await lastValueFrom(observable.pipe(toArray()));

    // Should NOT create a new query
    expect(queryStore.create).not.toHaveBeenCalled();
    // Should NOT start a new agent run
    expect(agentService.runStream).not.toHaveBeenCalled();

    // Should emit init + step + answer = 3 events (from polling)
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].type).toBe('init');
    expect(JSON.parse(events[0].data as string).queryId).toBe(existingQueryId);

    // Last event should be the answer
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe('answer');
    expect(JSON.parse(lastEvent.data as string).answer).toBe('Deduped answer');
  });

  // -------------------------------------------------------------------------
  // 22. Duplicate in-flight query should poll existing result (multi-agent)
  // -------------------------------------------------------------------------
  it('multi-agent stream should return existing query result when duplicate is in-flight', async () => {
    const response = fakeAgentResponse('Deduped pipeline answer');
    const existingQueryId = 'existing-pipeline-id';

    queryStore.findRunning.mockReturnValue(existingQueryId);

    queryStore.get.mockReturnValueOnce({
      queryId: existingQueryId,
      status: 'complete',
      response,
      pipelineEvents: [{ stage: 'retriever', status: 'done' }],
      steps: [],
      error: null,
      createdAt: Date.now(),
      completedAt: Date.now(),
    });

    const observable = controller.stream('What is Rust?', undefined, 'true');
    const events = await lastValueFrom(observable.pipe(toArray()));

    expect(queryStore.create).not.toHaveBeenCalled();
    expect(orchestratorService.runWithFallback).not.toHaveBeenCalled();

    expect(events[0].type).toBe('init');
    expect(JSON.parse(events[0].data as string).queryId).toBe(existingQueryId);

    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe('answer');
    expect(JSON.parse(lastEvent.data as string).answer).toBe('Deduped pipeline answer');
  });

  // -------------------------------------------------------------------------
  // 23. Poll should emit error when query expires
  // -------------------------------------------------------------------------
  it('poll should emit error when existing query expires from store', async () => {
    queryStore.findRunning.mockReturnValue('expired-query-id');
    queryStore.get.mockReturnValue(undefined);

    const observable = controller.stream('expiring query');
    const events = await lastValueFrom(observable.pipe(toArray()));

    expect(events[0].type).toBe('init');
    expect(events[1].type).toBe('error');
    expect(JSON.parse(events[1].data as string).message).toBe('Query expired');
  });

  // -------------------------------------------------------------------------
  // 24. Legacy stream should buffer steps and complete into QueryStore
  // -------------------------------------------------------------------------
  it('legacy stream should buffer steps and complete into QueryStore', async () => {
    const response = fakeAgentResponse();

    agentService.runStream.mockReturnValue(
      mockRunStream([
        { kind: 'step', step: response.steps[0] },
        { kind: 'complete', response },
      ]),
    );

    const observable = controller.stream('buffer test');
    await lastValueFrom(observable.pipe(toArray()));

    expect(queryStore.create).toHaveBeenCalledWith('buffer test', 'default');
    expect(queryStore.appendStep).toHaveBeenCalledTimes(1);
    expect(queryStore.complete).toHaveBeenCalledWith('test-query-id', response);
  });
});
