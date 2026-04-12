# LangGraph Orchestrator Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hand-rolled sequential orchestrator with a LangGraph StateGraph for declarative pipeline topology, automatic state threading, and less cognitive load.

**Architecture:** Define a `PipelineAnnotation` using LangGraph's `Annotation.Root()`. Build a `StateGraph` with three nodes (retriever → synthesizer → writer) connected by edges. The orchestrator streams with `streamMode: 'updates'` and maps node completion events to the existing `PipelineStreamEvent` protocol — zero frontend changes.

**Tech Stack:** `@langchain/langgraph@1.2.8` (already installed), NestJS, TypeScript

**Trade-off acknowledged:** ReAct steps from the retriever arrive in a batch when the retriever node completes, not one-by-one during execution. The retriever takes 5-15s, after which all steps render at once. If real-time step streaming is needed later, upgrade to `graph.streamEvents()`.

---

## Task 1: Create pipeline graph module with test

**Files:**

- Create: `apps/api/src/agent/pipeline-graph.ts`
- Create: `apps/api/src/agent/pipeline-graph.spec.ts`

### Step 1: Write the failing test

```typescript
// pipeline-graph.spec.ts
import { buildPipelineGraph, PipelineAnnotation } from './pipeline-graph';

describe('buildPipelineGraph', () => {
  it('should compile a graph with three nodes in order', async () => {
    const calls: string[] = [];

    const mockRetriever = async () => {
      calls.push('retriever');
      return {
        bundle: { query: 'q', themes: [], allSources: [], totalSourcesScanned: 0, tokenCount: 0 },
        steps: [],
      };
    };
    const mockSynthesizer = async () => {
      calls.push('synthesizer');
      return {
        analysis: { summary: 's', insights: [], contradictions: [], confidence: 'low', gaps: [] },
      };
    };
    const mockWriter = async () => {
      calls.push('writer');
      return {
        response: { headline: 'h', context: 'c', sections: [], bottomLine: 'b', sources: [] },
      };
    };

    const graph = buildPipelineGraph({
      retriever: mockRetriever,
      synthesizer: mockSynthesizer,
      writer: mockWriter,
    });

    const updates: Array<Record<string, unknown>> = [];
    for await (const update of await graph.stream({ query: 'test' }, { streamMode: 'updates' })) {
      updates.push(update as Record<string, unknown>);
    }

    expect(calls).toEqual(['retriever', 'synthesizer', 'writer']);
    expect(updates).toHaveLength(3);
    expect(Object.keys(updates[0])[0]).toBe('retriever');
    expect(Object.keys(updates[1])[0]).toBe('synthesizer');
    expect(Object.keys(updates[2])[0]).toBe('writer');
  });

  it('should propagate state between nodes', async () => {
    const capturedStates: Record<string, unknown>[] = [];
    const mockBundle = {
      query: 'q',
      themes: [{ label: 'T', items: [] }],
      allSources: [{ storyId: 1, title: 'S', url: '', author: 'a', points: 10, commentCount: 5 }],
      totalSourcesScanned: 1,
      tokenCount: 100,
    };
    const mockAnalysis = {
      summary: 's',
      insights: [{ claim: 'c', reasoning: 'r', evidenceStrength: 'strong', themeIndices: [0] }],
      contradictions: [],
      confidence: 'high',
      gaps: [],
    };

    const graph = buildPipelineGraph({
      retriever: async () => ({ bundle: mockBundle, steps: [] }),
      synthesizer: async (state) => {
        capturedStates.push({ bundle: state.bundle });
        return { analysis: mockAnalysis };
      },
      writer: async (state) => {
        capturedStates.push({ analysis: state.analysis, bundle: state.bundle });
        return {
          response: { headline: 'h', context: 'c', sections: [], bottomLine: 'b', sources: [] },
        };
      },
    });

    for await (const _ of await graph.stream({ query: 'test' }, { streamMode: 'updates' })) {
      // consume
    }

    expect(capturedStates[0].bundle).toEqual(mockBundle);
    expect(capturedStates[1].analysis).toEqual(mockAnalysis);
    expect(capturedStates[1].bundle).toEqual(mockBundle);
  });

  it('steps reducer should accumulate across nodes', async () => {
    const step1 = { type: 'action' as const, content: 'search', timestamp: 1 };
    const step2 = { type: 'observation' as const, content: 'found', timestamp: 2 };

    let finalSteps: unknown[] = [];
    const graph = buildPipelineGraph({
      retriever: async () => ({
        bundle: { query: 'q', themes: [], allSources: [], totalSourcesScanned: 0, tokenCount: 0 },
        steps: [step1, step2],
      }),
      synthesizer: async (state) => {
        finalSteps = state.steps ?? [];
        return {
          analysis: { summary: 's', insights: [], contradictions: [], confidence: 'low', gaps: [] },
        };
      },
      writer: async () => ({
        response: { headline: 'h', context: 'c', sections: [], bottomLine: 'b', sources: [] },
      }),
    });

    for await (const _ of await graph.stream({ query: 'test' }, { streamMode: 'updates' })) {
      // consume
    }

    expect(finalSteps).toEqual([step1, step2]);
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx nx test api -- --testPathPattern=pipeline-graph.spec`
Expected: FAIL — module `./pipeline-graph` does not exist

### Step 3: Write minimal implementation

```typescript
// pipeline-graph.ts
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import type {
  EvidenceBundle,
  AnalysisResult,
  AgentResponseV2,
  AgentStep,
} from '@voxpopuli/shared-types';

/**
 * LangGraph state annotation for the multi-agent pipeline.
 *
 * - `query` is provided as input
 * - `bundle`, `analysis`, `response` are set by their respective nodes
 * - `steps` accumulates ReAct steps from the retriever via a reducer
 */
export const PipelineAnnotation = Annotation.Root({
  query: Annotation<string>,
  bundle: Annotation<EvidenceBundle | undefined>({
    default: () => undefined,
    reducer: (_prev, next) => next,
  }),
  analysis: Annotation<AnalysisResult | undefined>({
    default: () => undefined,
    reducer: (_prev, next) => next,
  }),
  response: Annotation<AgentResponseV2 | undefined>({
    default: () => undefined,
    reducer: (_prev, next) => next,
  }),
  steps: Annotation<AgentStep[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),
});

export type PipelineGraphState = typeof PipelineAnnotation.State;

type PipelineNodeFn = (state: PipelineGraphState) => Promise<Partial<PipelineGraphState>>;

/**
 * Build and compile the pipeline StateGraph.
 *
 * Topology: START → retriever → synthesizer → writer → END
 */
export function buildPipelineGraph(nodes: {
  retriever: PipelineNodeFn;
  synthesizer: PipelineNodeFn;
  writer: PipelineNodeFn;
}) {
  return new StateGraph(PipelineAnnotation)
    .addNode('retriever', nodes.retriever)
    .addNode('synthesizer', nodes.synthesizer)
    .addNode('writer', nodes.writer)
    .addEdge(START, 'retriever')
    .addEdge('retriever', 'synthesizer')
    .addEdge('synthesizer', 'writer')
    .addEdge('writer', END)
    .compile();
}
```

### Step 4: Run test to verify it passes

Run: `npx nx test api -- --testPathPattern=pipeline-graph.spec`
Expected: PASS (3 tests)

### Step 5: Commit

```bash
git add apps/api/src/agent/pipeline-graph.ts apps/api/src/agent/pipeline-graph.spec.ts
git commit -m "feat(agent): add LangGraph pipeline graph definition with tests"
```

---

## Task 2: Adapt retriever node from async generator to async function

**Files:**

- Modify: `apps/api/src/agent/nodes/retriever.node.ts`
- Modify: `apps/api/src/agent/nodes/retriever.node.spec.ts`

The retriever currently returns `AsyncGenerator<RetrieverEvent>`. It needs to become a regular async function returning `{ bundle, steps }` so it works as a LangGraph node.

### Step 1: Write the failing test for the new return type

Add a new test to `retriever.node.spec.ts`:

```typescript
it('should return bundle and accumulated steps (non-generator)', async () => {
  // ... setup mocks for reactAgent.stream and model.invoke (same pattern as existing tests)
  const retriever = createRetrieverNode(mockModel, mockTools);
  const result = await retriever({ query: 'test query' });

  expect(result.bundle).toBeDefined();
  expect(result.bundle.themes).toBeDefined();
  expect(Array.isArray(result.steps)).toBe(true);
});
```

Run: `npx nx test api -- --testPathPattern=retriever.node.spec`
Expected: FAIL — `retriever()` returns an AsyncGenerator, not a Promise

### Step 2: Refactor createRetrieverNode

Change the return type from `AsyncGenerator<RetrieverEvent>` to `Promise<{ bundle: EvidenceBundle; steps: AgentStep[] }>`.

Key changes in `retriever.node.ts`:

- Remove `export type RetrieverEvent` (no longer needed)
- Change `async function*` to `async function`
- Replace `yield { kind: 'step', step }` with `steps.push(step)`
- Replace `yield { kind: 'result', bundle }` with `return { bundle, steps }`
- Keep all internal logic (ReAct streaming, dry-well detection, compaction) identical

```typescript
export function createRetrieverNode(model: BaseChatModel, tools: StructuredToolInterface[]) {
  const reactAgent = createReactAgent({
    llm: model,
    tools,
    prompt: RETRIEVER_SYSTEM_PROMPT.replace(
      '{{maxIterations}}',
      String(MAX_REACT_ITERATIONS),
    ).replace('{{currentDate}}', new Date().toISOString().split('T')[0]),
  });

  return async (state: {
    query: string;
  }): Promise<{ bundle: EvidenceBundle; steps: AgentStep[] }> => {
    const steps: AgentStep[] = [];
    const allMessages: any[] = [];

    const stream = await reactAgent.stream(
      { messages: [new HumanMessage(state.query)] },
      {
        metadata: { pipeline_stage: 'retriever', phase: 'react', query: state.query },
        tags: ['multi-agent', 'retriever', 'react'],
        streamMode: 'values',
      },
    );

    let prevMessageCount = 0;
    for await (const chunk of stream) {
      const messages = chunk.messages ?? [];
      if (messages.length > prevMessageCount) {
        for (let i = prevMessageCount; i < messages.length; i++) {
          const msg = messages[i] as any;
          const type = typeof msg._getType === 'function' ? msg._getType() : undefined;
          const content = typeof msg.content === 'string' ? msg.content : '';

          if (type === 'ai' && msg.tool_calls?.length > 0) {
            for (const tc of msg.tool_calls) {
              steps.push({
                type: 'action',
                content: `${tc.name}(${JSON.stringify(tc.args)})`,
                toolName: tc.name,
                toolInput: tc.args,
                timestamp: Date.now(),
              });
            }
          } else if (type === 'tool') {
            steps.push({
              type: 'observation',
              content: content.slice(0, 500),
              timestamp: Date.now(),
            });
          } else if (type === 'ai' && content) {
            steps.push({
              type: 'thought',
              content,
              timestamp: Date.now(),
            });
          }
        }
      }
      prevMessageCount = messages.length;
      if (messages.length > 0) {
        allMessages.length = 0;
        allMessages.push(...messages);
      }
    }

    const rawData = allMessages
      .filter((m) => {
        if (typeof m._getType !== 'function') return true;
        const type = m._getType();
        return type !== 'system' && type !== 'human';
      })
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n\n');

    if (isDryWell(rawData)) {
      return { bundle: buildDryWellBundle(state.query), steps };
    }

    const bundle = await compactWithRetry(model, state.query, rawData);
    return { bundle, steps };
  };
}
```

### Step 3: Update existing tests

All existing tests that iterate the retriever as a generator need to be updated to await the function call instead:

```typescript
// Before:
const events = [];
for await (const event of retriever({ query: 'test' })) {
  events.push(event);
}
const bundle = events.find((e) => e.kind === 'result')?.bundle;
const steps = events.filter((e) => e.kind === 'step');

// After:
const { bundle, steps } = await retriever({ query: 'test' });
```

### Step 4: Run tests to verify they pass

Run: `npx nx test api -- --testPathPattern=retriever.node.spec`
Expected: PASS

### Step 5: Commit

```bash
git add apps/api/src/agent/nodes/retriever.node.ts apps/api/src/agent/nodes/retriever.node.spec.ts
git commit -m "refactor(agent): convert retriever node from generator to async function"
```

---

## Task 3: Add retry wrapper utilities with tests

**Files:**

- Add to: `apps/api/src/agent/pipeline-graph.ts`
- Add to: `apps/api/src/agent/pipeline-graph.spec.ts`

The orchestrator currently has retry logic for synthesizer (retry once, throw on double-fail) and writer (retry once, fallback response on double-fail). Move this into composable wrappers co-located with the graph.

### Step 1: Write failing tests for retry wrappers

Add to `pipeline-graph.spec.ts`:

```typescript
import { withRetry, withWriterFallback } from './pipeline-graph';

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const fn = jest.fn().mockResolvedValue({ analysis: 'ok' });
    const wrapped = withRetry(fn);
    const result = await wrapped({ query: 'q' } as any);
    expect(result).toEqual({ analysis: 'ok' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry once on failure then return', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ analysis: 'ok' });
    const wrapped = withRetry(fn);
    const result = await wrapped({ query: 'q' } as any);
    expect(result).toEqual({ analysis: 'ok' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw on double failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const wrapped = withRetry(fn);
    await expect(wrapped({ query: 'q' } as any)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withWriterFallback', () => {
  it('should return result on success', async () => {
    const fn = jest.fn().mockResolvedValue({ response: 'ok' });
    const fallback = jest.fn();
    const wrapped = withWriterFallback(fn, fallback);
    const result = await wrapped({ query: 'q' } as any);
    expect(result).toEqual({ response: 'ok' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('should retry once then use fallback on double failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const fallback = jest.fn().mockReturnValue({ response: 'fallback' });
    const wrapped = withWriterFallback(fn, fallback);
    const result = await wrapped({ query: 'q', bundle: {}, analysis: {} } as any);
    expect(result).toEqual({ response: 'fallback' });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx nx test api -- --testPathPattern=pipeline-graph.spec`
Expected: FAIL — `withRetry` and `withWriterFallback` do not exist

### Step 3: Implement wrappers

Add to `pipeline-graph.ts`:

```typescript
/**
 * Wrap a node function with retry-once semantics.
 * On first failure, retries once. On second failure, throws.
 */
export function withRetry(fn: PipelineNodeFn): PipelineNodeFn {
  return async (state) => {
    try {
      return await fn(state);
    } catch {
      return await fn(state);
    }
  };
}

/**
 * Wrap the writer node with retry-once + fallback semantics.
 * On double failure, calls the fallback function instead of throwing.
 */
export function withWriterFallback(
  fn: PipelineNodeFn,
  fallback: (state: PipelineGraphState) => Partial<PipelineGraphState>,
): PipelineNodeFn {
  return async (state) => {
    try {
      return await fn(state);
    } catch {
      try {
        return await fn(state);
      } catch {
        return fallback(state);
      }
    }
  };
}
```

### Step 4: Run tests to verify they pass

Run: `npx nx test api -- --testPathPattern=pipeline-graph.spec`
Expected: PASS

### Step 5: Commit

```bash
git add apps/api/src/agent/pipeline-graph.ts apps/api/src/agent/pipeline-graph.spec.ts
git commit -m "feat(agent): add retry and fallback wrappers for pipeline nodes"
```

---

## Task 4: Rewrite OrchestratorService to use StateGraph

**Files:**

- Modify: `apps/api/src/agent/orchestrator.service.ts`
- Modify: `apps/api/src/agent/orchestrator.service.spec.ts`

### Step 1: Write the failing tests for the new orchestrator

Rewrite `orchestrator.service.spec.ts`. The key difference: instead of mocking individual node factories, mock `buildPipelineGraph` to return a fake compiled graph whose `.stream()` yields predefined updates.

```typescript
// orchestrator.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { OrchestratorService, type PipelineStreamEvent } from './orchestrator.service';
import { AgentService } from './agent.service';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import type {
  PipelineConfig,
  EvidenceBundle,
  AnalysisResult,
  AgentResponseV2,
  PipelineEvent,
} from '@voxpopuli/shared-types';

jest.mock('langchain', () => ({ createAgent: jest.fn() }));
jest.mock('./tools', () => ({ createAgentTools: jest.fn(() => []) }));
jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));
jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(() => ({ invoke: jest.fn() })),
}));

// Mock the pipeline graph builder
jest.mock('./pipeline-graph', () => ({
  buildPipelineGraph: jest.fn(),
  withRetry: jest.fn((fn) => fn),
  withWriterFallback: jest.fn((fn, fallback) => async (state: any) => {
    try {
      return await fn(state);
    } catch {
      try {
        return await fn(state);
      } catch {
        return fallback(state);
      }
    }
  }),
}));

jest.mock('./nodes/retriever.node', () => ({
  createRetrieverNode: jest.fn(() => jest.fn()),
}));
jest.mock('./nodes/synthesizer.node', () => ({
  createSynthesizerNode: jest.fn(() => jest.fn()),
}));
jest.mock('./nodes/writer.node', () => ({
  createWriterNode: jest.fn(() => jest.fn()),
}));

import { buildPipelineGraph } from './pipeline-graph';

// Shared fixtures (same as before)
const mockBundle: EvidenceBundle = {
  query: 'test query',
  themes: [
    { label: 'T', items: [{ sourceId: 1, text: 'evidence', type: 'evidence', relevance: 0.9 }] },
  ],
  allSources: [{ storyId: 1, title: 'S1', url: '', author: 'a', points: 10, commentCount: 5 }],
  totalSourcesScanned: 3,
  tokenCount: 500,
};

const mockAnalysis: AnalysisResult = {
  summary: 'Test summary',
  insights: [
    { claim: 'Claim 1', reasoning: 'Reason 1', evidenceStrength: 'strong', themeIndices: [0] },
  ],
  contradictions: [],
  confidence: 'high',
  gaps: [],
};

const mockResponseV2: AgentResponseV2 = {
  headline: 'Test headline',
  context: 'Test context',
  sections: [
    { heading: 'S1', body: 'Body 1', citedSources: [1] },
    { heading: 'S2', body: 'Body 2', citedSources: [1] },
  ],
  bottomLine: 'Test bottom line',
  sources: [{ storyId: 1, title: 'S1', url: '', author: 'a', points: 10, commentCount: 5 }],
};

const defaultConfig: PipelineConfig = {
  useMultiAgent: true,
  providerMap: {},
  tokenBudgets: { retriever: 2000, synthesizer: 1500, synthesizerInput: 4000, writer: 1000 },
  timeout: 30000,
};

/** Create a mock compiled graph whose .stream() yields the given updates. */
function mockGraph(updates: Array<Record<string, unknown>>) {
  return {
    stream: jest.fn().mockResolvedValue(
      (async function* () {
        for (const update of updates) {
          yield update;
        }
      })(),
    ),
  };
}

/** Standard happy-path graph updates. */
function happyPathUpdates() {
  return [
    {
      retriever: {
        bundle: mockBundle,
        steps: [
          {
            type: 'action',
            content: 'search_hn(...)',
            toolName: 'search_hn',
            toolInput: {},
            timestamp: 1,
          },
        ],
      },
    },
    { synthesizer: { analysis: mockAnalysis } },
    { writer: { response: mockResponseV2 } },
  ];
}

function makeLegacyEvents() {
  return (async function* () {
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
}

async function collectEvents(gen: AsyncGenerator<any>): Promise<PipelineStreamEvent[]> {
  const events: PipelineStreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let agentService: AgentService;

  const mockLlm = {
    getModel: jest.fn(() => ({ invoke: jest.fn(), stream: jest.fn() })),
    getProviderName: jest.fn(() => 'groq'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestratorService,
        { provide: AgentService, useValue: { runStream: jest.fn() } },
        { provide: LlmService, useValue: mockLlm },
        { provide: HnService, useValue: {} },
        { provide: ChunkerService, useValue: {} },
      ],
    }).compile();

    service = module.get(OrchestratorService);
    agentService = module.get(AgentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('happy path', () => {
    beforeEach(() => {
      (buildPipelineGraph as jest.Mock).mockReturnValue(mockGraph(happyPathUpdates()));
    });

    it('should stream pipeline events and complete on success', async () => {
      const events = await collectEvents(service.runStream('test query', defaultConfig));

      const pipelineEvents = events.filter((e) => e.kind === 'pipeline');
      const completeEvents = events.filter((e) => e.kind === 'complete');
      // started + done for each of 3 stages = 6 pipeline events
      expect(pipelineEvents.length).toBe(6);
      expect(completeEvents.length).toBe(1);
    });

    it('should emit steps from retriever', async () => {
      const events = await collectEvents(service.runStream('test query', defaultConfig));
      const stepEvents = events.filter((e) => e.kind === 'step');
      expect(stepEvents.length).toBeGreaterThan(0);
    });

    it('SSE PipelineEvents emitted at each stage transition', async () => {
      const events = await collectEvents(service.runStream('test query', defaultConfig));
      const pipelineEvents = events
        .filter((e) => e.kind === 'pipeline')
        .map((e) => ({ stage: (e as any).event.stage, status: (e as any).event.status }));

      expect(pipelineEvents).toEqual([
        { stage: 'retriever', status: 'started' },
        { stage: 'retriever', status: 'done' },
        { stage: 'synthesizer', status: 'started' },
        { stage: 'synthesizer', status: 'done' },
        { stage: 'writer', status: 'started' },
        { stage: 'writer', status: 'done' },
      ]);
    });

    it('should produce an answer with headline and sections', async () => {
      const events = await collectEvents(service.runStream('test query', defaultConfig));
      const complete = events.find((e) => e.kind === 'complete') as any;
      expect(complete.response.answer).toContain('Test headline');
      expect(complete.response.answer).toContain('Body 1');
      expect(complete.response.answer).toContain('Test bottom line');
    });

    it('PipelineResult contains valid sources and meta', async () => {
      const events = await collectEvents(service.runStream('test query', defaultConfig));
      const complete = events.find((e) => e.kind === 'complete') as any;
      expect(complete.response.sources.length).toBeGreaterThan(0);
      expect(complete.response.sources[0].storyId).toBe(1);
      expect(complete.response.meta.provider).toBe('groq');
      expect(complete.response.meta.durationMs).toBeGreaterThanOrEqual(0);
      expect(complete.response.trust).toBeDefined();
    });
  });

  describe('retriever failure', () => {
    it('should fall back to legacy agent when graph throws', async () => {
      (buildPipelineGraph as jest.Mock).mockReturnValue({
        stream: jest.fn().mockRejectedValue(new Error('Retriever kaboom')),
      });
      (agentService.runStream as jest.Mock).mockReturnValue(makeLegacyEvents());

      const events = await collectEvents(service.runWithFallback('test query', defaultConfig));

      expect(agentService.runStream).toHaveBeenCalledWith('test query');
      expect(events.some((e) => e.kind === 'pipeline' && (e as any).event.status === 'error')).toBe(
        true,
      );
    });
  });

  describe('writer fallback', () => {
    it('should use fallback response when writer returns undefined response', async () => {
      (buildPipelineGraph as jest.Mock).mockReturnValue(
        mockGraph([
          { retriever: { bundle: mockBundle, steps: [] } },
          { synthesizer: { analysis: mockAnalysis } },
          { writer: { response: undefined } },
        ]),
      );

      const events = await collectEvents(service.runStream('test query', defaultConfig));
      const complete = events.find((e) => e.kind === 'complete') as any;
      expect(complete).toBeDefined();
      expect(complete.response.answer).toContain('Test summary');
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx nx test api -- --testPathPattern=orchestrator.service.spec`
Expected: FAIL — new orchestrator implementation doesn't exist yet

### Step 3: Implement the new orchestrator

```typescript
// orchestrator.service.ts
import { Injectable, Logger } from '@nestjs/common';
import type {
  PipelineConfig,
  PipelineEvent,
  AgentResponseV2,
  AgentStep,
  AgentResponse,
  PipelineStage,
} from '@voxpopuli/shared-types';
import { AgentService, type AgentStreamEvent } from './agent.service';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import { createAgentTools } from './tools';
import { computeTrustMetadata } from './trust';
import { buildFallbackResponse } from './fallback-response';
import { createRetrieverNode } from './nodes/retriever.node';
import { createSynthesizerNode } from './nodes/synthesizer.node';
import { createWriterNode } from './nodes/writer.node';
import { buildPipelineGraph, withRetry, withWriterFallback } from './pipeline-graph';

// ---------------------------------------------------------------------------
// Stream event types (public API — unchanged)
// ---------------------------------------------------------------------------

export type PipelineStreamEvent =
  | { kind: 'pipeline'; event: PipelineEvent }
  | { kind: 'step'; step: AgentStep }
  | { kind: 'token'; content: string }
  | { kind: 'complete'; response: AgentResponse };

/**
 * Orchestrates the multi-agent pipeline via LangGraph StateGraph.
 *
 * Topology: retriever → synthesizer → writer
 * Streaming: streamMode 'updates' — emits state updates per node completion.
 *
 * Recovery:
 * - Synthesizer: retry once (via withRetry wrapper), throw on double-fail → bubbles to runWithFallback
 * - Writer: retry once + fallback response (via withWriterFallback wrapper)
 * - Any graph failure → runWithFallback catches → legacy AgentService
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly llm: LlmService,
    private readonly hn: HnService,
    private readonly chunker: ChunkerService,
  ) {}

  async *runWithFallback(
    query: string,
    config: PipelineConfig,
  ): AsyncGenerator<PipelineStreamEvent | AgentStreamEvent> {
    try {
      yield* this.runStream(query, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Pipeline failed, falling back to legacy AgentService: ${message}`);

      yield {
        kind: 'pipeline',
        event: {
          stage: 'retriever' as const,
          status: 'error' as const,
          detail: message,
          elapsed: 0,
        },
      } as PipelineStreamEvent;

      for await (const event of this.agentService.runStream(query)) {
        yield event;
      }
    }
  }

  async *runStream(query: string, config: PipelineConfig): AsyncGenerator<PipelineStreamEvent> {
    const startTime = Date.now();

    const activeProvider =
      config.providerMap.retriever ??
      config.providerMap.synthesizer ??
      config.providerMap.writer ??
      this.llm.getProviderName();

    const getModel = (stage: 'retriever' | 'synthesizer' | 'writer') =>
      this.llm.getModel(config.providerMap[stage]);

    const tools = createAgentTools(this.hn, this.chunker);

    const writerFallback = (state: { analysis?: any; bundle?: any }) => ({ response: undefined }); // signal to use buildFallbackResponse below

    const graph = buildPipelineGraph({
      retriever: createRetrieverNode(getModel('retriever'), tools),
      synthesizer: withRetry(createSynthesizerNode(getModel('synthesizer'))),
      writer: withWriterFallback(createWriterNode(getModel('writer')), writerFallback),
    });

    const stageOrder: PipelineStage[] = ['retriever', 'synthesizer', 'writer'];
    const stageStartMessages: Record<string, string> = {
      retriever: `Searching HN for "${query}"...`,
      synthesizer: 'Analyzing themes...',
      writer: 'Composing headline and sections...',
    };

    let stageIdx = 0;
    let stageStart = Date.now();

    // Accumulated state for building final response
    let bundle: import('@voxpopuli/shared-types').EvidenceBundle | undefined;
    let analysis: import('@voxpopuli/shared-types').AnalysisResult | undefined;
    let writerResponse: AgentResponseV2 | undefined;

    // Emit first stage started
    yield {
      kind: 'pipeline',
      event: {
        stage: 'retriever',
        status: 'started',
        detail: stageStartMessages.retriever,
        elapsed: 0,
      },
    };

    const stream = await graph.stream({ query }, { streamMode: 'updates' as const });

    for await (const update of stream) {
      const nodeName = Object.keys(update)[0] as PipelineStage;
      const nodeOutput = (update as Record<string, Record<string, unknown>>)[nodeName];

      // Accumulate state
      if (nodeName === 'retriever') {
        bundle = nodeOutput.bundle as typeof bundle;
        const steps = (nodeOutput.steps ?? []) as AgentStep[];
        for (const step of steps) {
          yield { kind: 'step', step };
        }
        yield {
          kind: 'pipeline',
          event: {
            stage: 'retriever',
            status: 'done',
            detail: `${bundle?.themes.length ?? 0} themes from ${
              bundle?.allSources.length ?? 0
            } sources`,
            elapsed: Date.now() - stageStart,
          },
        };
      } else if (nodeName === 'synthesizer') {
        analysis = nodeOutput.analysis as typeof analysis;
        yield {
          kind: 'pipeline',
          event: {
            stage: 'synthesizer',
            status: 'done',
            detail: `${analysis?.insights.length ?? 0} insights, confidence: ${
              analysis?.confidence ?? 'unknown'
            }`,
            elapsed: Date.now() - stageStart,
          },
        };
      } else if (nodeName === 'writer') {
        writerResponse = nodeOutput.response as typeof writerResponse;
        yield {
          kind: 'pipeline',
          event: {
            stage: 'writer',
            status: 'done',
            detail: writerResponse
              ? `${writerResponse.sections.length} sections, ${writerResponse.sources.length} sources`
              : 'Using fallback response from analysis',
            elapsed: Date.now() - stageStart,
          },
        };
      }

      // Emit next stage started
      stageIdx++;
      if (stageIdx < stageOrder.length) {
        stageStart = Date.now();
        const nextStage = stageOrder[stageIdx];
        const detail =
          nextStage === 'synthesizer'
            ? `Analyzing ${bundle?.themes.length ?? 0} themes...`
            : stageStartMessages[nextStage];
        yield {
          kind: 'pipeline',
          event: { stage: nextStage, status: 'started', detail, elapsed: 0 },
        };
      }
    }

    // Emit final response
    const elapsed = () => Date.now() - startTime;

    if (writerResponse) {
      const sources = writerResponse.sources.map((s) => ({
        storyId: s.storyId,
        title: s.title,
        url: s.url ?? '',
        author: s.author,
        points: s.points,
        commentCount: s.commentCount,
      }));

      yield {
        kind: 'complete',
        response: {
          answer: `## ${writerResponse.headline}\n\n${
            writerResponse.context
          }\n\n${writerResponse.sections
            .map((s) => `### ${s.heading}\n\n${s.body}`)
            .join('\n\n')}\n\n**Bottom line:** ${writerResponse.bottomLine}`,
          steps: [],
          sources,
          meta: {
            provider: activeProvider,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            durationMs: elapsed(),
            cached: false,
          },
          trust: computeTrustMetadata(
            [],
            sources,
            writerResponse.headline + ' ' + writerResponse.sections.map((s) => s.body).join(' '),
          ),
        },
      };
    } else if (analysis && bundle) {
      yield {
        kind: 'complete',
        response: buildFallbackResponse(analysis, bundle, {
          provider: activeProvider,
          durationMs: elapsed(),
          totalInputTokens: 0,
          totalOutputTokens: 0,
        }),
      };
    }
  }
}
```

### Step 4: Run tests to verify they pass

Run: `npx nx test api -- --testPathPattern=orchestrator.service.spec`
Expected: PASS

### Step 5: Commit

```bash
git add apps/api/src/agent/orchestrator.service.ts apps/api/src/agent/orchestrator.service.spec.ts
git commit -m "refactor(agent): rewrite orchestrator to use LangGraph StateGraph"
```

---

## Task 5: Run full test suite and verify no regressions

**Files:** None (verification only)

### Step 1: Run all agent tests

Run: `npx nx test api -- --testPathPattern=agent`
Expected: PASS — all agent tests pass

### Step 2: Run all API tests

Run: `npx nx test api`
Expected: PASS — including rag controller tests (the controller's `streamMultiAgent` is unchanged since `PipelineStreamEvent` shape is preserved)

### Step 3: Run affected lint

Run: `npx nx affected:lint`
Expected: PASS

### Step 4: Commit any final fixes

```bash
git add -A
git commit -m "test(agent): verify LangGraph orchestrator integration"
```

---

## Summary of changes

| File                           | Change                                                        | Lines (approx)    |
| ------------------------------ | ------------------------------------------------------------- | ----------------- |
| `pipeline-graph.ts`            | **New** — Annotation, StateGraph builder, retry wrappers      | ~70               |
| `pipeline-graph.spec.ts`       | **New** — graph compilation, state propagation, wrapper tests | ~120              |
| `retriever.node.ts`            | **Modified** — generator → async function                     | ~10 lines changed |
| `retriever.node.spec.ts`       | **Modified** — update to await instead of iterate             | ~15 lines changed |
| `orchestrator.service.ts`      | **Rewritten** — StateGraph streaming                          | ~120 (was ~295)   |
| `orchestrator.service.spec.ts` | **Rewritten** — mock graph instead of mock nodes              | ~180              |
| `synthesizer.node.ts`          | **Unchanged**                                                 | 0                 |
| `writer.node.ts`               | **Unchanged**                                                 | 0                 |
| `rag.controller.ts`            | **Unchanged**                                                 | 0                 |
| Frontend                       | **Unchanged**                                                 | 0                 |

**Net effect:** ~175 lines deleted, declarative pipeline topology, retry logic co-located with nodes.
