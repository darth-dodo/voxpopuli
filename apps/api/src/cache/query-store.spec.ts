import { QueryStore } from './query-store';
import { CacheService } from './cache.service';
import type { AgentResponse, AgentStep, StoredPipelineEvent } from '@voxpopuli/shared-types';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('QueryStore', () => {
  let store: QueryStore;
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
    store = new QueryStore(cache);
  });

  const mockResponse: AgentResponse = {
    answer: 'Test answer',
    steps: [],
    sources: [],
    meta: {
      provider: 'mistral',
      model: 'test-model',
      tokensUsed: 100,
      latencyMs: 500,
      agentSteps: 3,
    },
    trust: {
      sourceCount: 1,
      avgSourceAge: 5,
      hasConflictingViews: false,
      claimVerification: [],
    },
  };

  const mockStep: AgentStep = {
    type: 'thought',
    content: 'Thinking about the query...',
  };

  const mockEvent: StoredPipelineEvent = {
    stage: 'retriever',
    status: 'running',
    detail: 'Searching HN stories',
    timestamp: Date.now(),
  };

  it('create() stores entry retrievable by get()', () => {
    const queryId = store.create('test query', 'mistral');
    const entry = store.get(queryId);

    expect(entry).toBeDefined();
    expect(entry!.queryId).toBe(queryId);
    expect(entry!.status).toBe('running');
    expect(entry!.response).toBeNull();
    expect(entry!.pipelineEvents).toEqual([]);
    expect(entry!.steps).toEqual([]);
    expect(entry!.error).toBeNull();
    expect(entry!.createdAt).toBeGreaterThan(0);
    expect(entry!.completedAt).toBeNull();
  });

  it('create() returns a UUID v4', () => {
    const queryId = store.create('test query', 'mistral');
    expect(queryId).toMatch(UUID_V4_RE);
  });

  it('appendEvent() adds pipeline events to stored entry', () => {
    const queryId = store.create('test query', 'mistral');

    store.appendEvent(queryId, mockEvent);
    store.appendEvent(queryId, { ...mockEvent, stage: 'synthesizer' });

    const entry = store.get(queryId);
    expect(entry!.pipelineEvents).toHaveLength(2);
    expect(entry!.pipelineEvents[0].stage).toBe('retriever');
    expect(entry!.pipelineEvents[1].stage).toBe('synthesizer');
  });

  it('appendStep() adds agent steps to stored entry', () => {
    const queryId = store.create('test query', 'mistral');

    store.appendStep(queryId, mockStep);
    store.appendStep(queryId, { type: 'action', content: 'search_hn', toolName: 'search_hn' });

    const entry = store.get(queryId);
    expect(entry!.steps).toHaveLength(2);
    expect(entry!.steps[0].type).toBe('thought');
    expect(entry!.steps[1].type).toBe('action');
  });

  it('complete() sets status to complete with response and completedAt', () => {
    const queryId = store.create('test query', 'mistral');

    store.complete(queryId, mockResponse);

    const entry = store.get(queryId);
    expect(entry!.status).toBe('complete');
    expect(entry!.response).toEqual(mockResponse);
    expect(entry!.completedAt).toBeGreaterThan(0);
  });

  it('fail() sets status to error with error message', () => {
    const queryId = store.create('test query', 'mistral');

    store.fail(queryId, 'LLM provider timeout');

    const entry = store.get(queryId);
    expect(entry!.status).toBe('error');
    expect(entry!.error).toBe('LLM provider timeout');
    expect(entry!.completedAt).toBeGreaterThan(0);
  });

  it('get() returns undefined for unknown queryId', () => {
    const entry = store.get('nonexistent-id');
    expect(entry).toBeUndefined();
  });

  it('findRunning() returns queryId for running query', () => {
    const queryId = store.create('test query', 'mistral');

    const found = store.findRunning('test query', 'mistral');
    expect(found).toBe(queryId);
  });

  it('findRunning() returns null for completed query', () => {
    const queryId = store.create('test query', 'mistral');
    store.complete(queryId, mockResponse);

    const found = store.findRunning('test query', 'mistral');
    expect(found).toBeNull();
  });

  it('findRunning() returns null for unknown query', () => {
    const found = store.findRunning('unknown query', 'mistral');
    expect(found).toBeNull();
  });
});
