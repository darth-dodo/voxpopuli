# Orchestrator Partial Failure Recovery

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-stage failure recovery to OrchestratorService so pipeline failures are handled gracefully: synthesizer/writer retry once, writer falls back to a minimal response built from AnalysisResult, and the Retriever is never re-run on downstream failures.

**Architecture:** Replace the LangGraph StateGraph with direct sequential node calls in the orchestrator. Each node becomes a pure data transformer (no event emission). The orchestrator owns all event emission and wraps each call in try/catch for stage-specific recovery. A new pure `buildFallbackResponse()` function constructs a minimal AgentResponse from AnalysisResult + EvidenceBundle when the Writer fails after retry.

**Tech Stack:** NestJS, TypeScript, Jest, Zod schemas from `@voxpopuli/shared-types`

**Linear Issue:** [AI-290](https://linear.app/ai-adventures/issue/AI-290/implement-orchestrator-partial-failure-recovery)

**Recovery Matrix:**

| Failure Point     | Recovery                                                            |
| ----------------- | ------------------------------------------------------------------- |
| Retriever fails   | Bubble to `runWithFallback()` → legacy AgentService                 |
| Synthesizer fails | Retry once with same EvidenceBundle, then bubble → legacy           |
| Writer fails      | Retry once with same AnalysisResult, then `buildFallbackResponse()` |

**Key rule:** Never re-run the Retriever on a downstream failure (it's the slowest/most expensive stage).

---

## Task 1: Write failing test for `buildFallbackResponse`

**Files:**

- Create: `apps/api/src/agent/fallback-response.ts` (empty placeholder)
- Create: `apps/api/src/agent/fallback-response.spec.ts`

**Step 1: Create empty export for `buildFallbackResponse`**

```typescript
// apps/api/src/agent/fallback-response.ts
import type { AgentResponse, AnalysisResult, EvidenceBundle } from '@voxpopuli/shared-types';

/**
 * Build a minimal AgentResponse from AnalysisResult + EvidenceBundle
 * when the Writer fails after retry.
 */
export function buildFallbackResponse(
  _analysis: AnalysisResult,
  _bundle: EvidenceBundle,
  _meta: {
    provider: string;
    durationMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  },
): AgentResponse {
  throw new Error('Not implemented');
}
```

**Step 2: Write the failing test**

```typescript
// apps/api/src/agent/fallback-response.spec.ts
import { buildFallbackResponse } from './fallback-response';
import type { AnalysisResult, EvidenceBundle } from '@voxpopuli/shared-types';

const mockBundle: EvidenceBundle = {
  query: 'test query',
  themes: [
    {
      label: 'Theme A',
      items: [{ sourceId: 1, text: 'Some evidence', type: 'evidence', relevance: 0.8 }],
    },
  ],
  allSources: [
    {
      storyId: 1,
      title: 'Story 1',
      url: 'https://example.com',
      author: 'alice',
      points: 100,
      commentCount: 50,
    },
    {
      storyId: 2,
      title: 'Story 2',
      url: 'https://example.com/2',
      author: 'bob',
      points: 200,
      commentCount: 30,
    },
  ],
  totalSourcesScanned: 5,
  tokenCount: 1200,
};

const mockAnalysis: AnalysisResult = {
  summary: 'HN community is divided on testing frameworks',
  insights: [
    {
      claim: 'Jest is the most popular choice',
      reasoning: 'Multiple sources cite Jest adoption rates',
      evidenceStrength: 'strong',
      themeIndices: [0],
    },
    {
      claim: 'Vitest is gaining momentum',
      reasoning: 'Recent posts show growing interest',
      evidenceStrength: 'moderate',
      themeIndices: [0],
    },
  ],
  contradictions: [
    { claim: 'Jest is slow', counterClaim: 'Jest is fast enough', sourceIds: [1, 2] },
  ],
  confidence: 'medium',
  gaps: ['No data on enterprise adoption'],
};

const mockMeta = {
  provider: 'groq',
  durationMs: 5000,
  totalInputTokens: 800,
  totalOutputTokens: 400,
};

describe('buildFallbackResponse', () => {
  it('should produce a valid AgentResponse with answer containing summary as headline', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);

    expect(result.answer).toContain('HN community is divided on testing frameworks');
  });

  it('should create one section per insight', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);

    // Each insight's claim should appear as a section heading
    expect(result.answer).toContain('Jest is the most popular choice');
    expect(result.answer).toContain('Vitest is gaining momentum');
    // Each insight's reasoning should appear as section body
    expect(result.answer).toContain('Multiple sources cite Jest adoption rates');
    expect(result.answer).toContain('Recent posts show growing interest');
  });

  it('should include confidence and gaps in the bottom line', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);

    expect(result.answer).toContain('medium');
    expect(result.answer).toContain('No data on enterprise adoption');
  });

  it('should map bundle.allSources to AgentSource format', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);

    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toEqual({
      storyId: 1,
      title: 'Story 1',
      url: 'https://example.com',
      author: 'alice',
      points: 100,
      commentCount: 50,
    });
  });

  it('should pass through meta with error flag', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);

    expect(result.meta).toMatchObject({
      provider: 'groq',
      durationMs: 5000,
      totalInputTokens: 800,
      totalOutputTokens: 400,
      cached: false,
      error: true,
    });
  });

  it('should include empty steps array', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);

    expect(result.steps).toEqual([]);
  });

  it('should include trust metadata', () => {
    const result = buildFallbackResponse(mockAnalysis, mockBundle, mockMeta);

    expect(result.trust).toBeDefined();
    expect(result.trust.sourcesTotal).toBe(2);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx nx test api --testPathPattern='fallback-response' --no-coverage`
Expected: FAIL — `throw new Error('Not implemented')`

**Step 4: Commit**

```bash
git add apps/api/src/agent/fallback-response.ts apps/api/src/agent/fallback-response.spec.ts
git commit -m "test(agent): RED — add failing tests for buildFallbackResponse"
```

---

## Task 2: Implement `buildFallbackResponse` to pass tests

**Files:**

- Modify: `apps/api/src/agent/fallback-response.ts`

**Step 1: Implement the function**

```typescript
// apps/api/src/agent/fallback-response.ts
import type { AgentResponse, AnalysisResult, EvidenceBundle } from '@voxpopuli/shared-types';
import { computeTrustMetadata } from './trust';

/**
 * Build a minimal AgentResponse from AnalysisResult + EvidenceBundle
 * when the Writer stage fails after retry.
 *
 * Mapping:
 * - headline = analysis.summary
 * - sections = one per insight (claim → heading, reasoning → body)
 * - bottomLine = confidence + gaps
 * - sources = bundle.allSources
 */
export function buildFallbackResponse(
  analysis: AnalysisResult,
  bundle: EvidenceBundle,
  meta: {
    provider: string;
    durationMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  },
): AgentResponse {
  const sections = analysis.insights
    .map((insight) => `### ${insight.claim}\n\n${insight.reasoning}`)
    .join('\n\n');

  const gapsList = analysis.gaps.length > 0 ? ` Gaps: ${analysis.gaps.join('; ')}.` : '';
  const bottomLine = `Confidence: ${analysis.confidence}.${gapsList}`;

  const answer = `## ${analysis.summary}\n\n${sections}\n\n**Bottom line:** ${bottomLine}`;

  const sources = bundle.allSources.map((s) => ({
    storyId: s.storyId,
    title: s.title,
    url: s.url,
    author: s.author,
    points: s.points,
    commentCount: s.commentCount,
  }));

  return {
    answer,
    steps: [],
    sources,
    meta: {
      ...meta,
      cached: false,
      error: true,
    },
    trust: computeTrustMetadata([], sources, answer),
  };
}
```

**Step 2: Run test to verify it passes**

Run: `npx nx test api --testPathPattern='fallback-response' --no-coverage`
Expected: All 6 tests PASS

**Step 3: Commit**

```bash
git add apps/api/src/agent/fallback-response.ts
git commit -m "feat(agent): GREEN — implement buildFallbackResponse for Writer failure fallback"
```

---

## Task 3: Strip `dispatchCustomEvent` from node functions

**Why:** The orchestrator will call nodes directly (not via LangGraph graph) for per-stage recovery. `dispatchCustomEvent` requires a LangGraph callback context and throws outside one. Nodes should be pure data transformers; the orchestrator owns event emission.

**Files:**

- Modify: `apps/api/src/agent/nodes/retriever.node.ts`
- Modify: `apps/api/src/agent/nodes/synthesizer.node.ts`
- Modify: `apps/api/src/agent/nodes/writer.node.ts`

**Step 1: Refactor retriever.node.ts — remove `dispatchCustomEvent` calls**

Remove the `import { dispatchCustomEvent }` line and all three `await dispatchCustomEvent(...)` calls. The node function signature stays the same. Keep the `pipeline_response` dispatch in the writer (the orchestrator will handle it differently).

```typescript
// apps/api/src/agent/nodes/retriever.node.ts
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { EvidenceBundleSchema, type EvidenceBundle } from '@voxpopuli/shared-types';
import { RETRIEVER_SYSTEM_PROMPT } from '../prompts/retriever.prompt';
import { COMPACTOR_SYSTEM_PROMPT } from '../prompts/compactor.prompt';
import { cleanLlmOutput } from './parse-llm-json';

const MAX_REACT_ITERATIONS = 8;

/**
 * Creates the Retriever node function for the pipeline.
 *
 * Two phases:
 * 1. ReAct loop (createReactAgent) — collects raw HN data via tools
 * 2. Compaction (single LLM call) — converts raw data → EvidenceBundle
 */
export function createRetrieverNode(model: BaseChatModel, tools: StructuredToolInterface[]) {
  const reactAgent = createReactAgent({
    llm: model,
    tools,
    prompt: RETRIEVER_SYSTEM_PROMPT.replace(
      '{{maxIterations}}',
      String(MAX_REACT_ITERATIONS),
    ).replace('{{currentDate}}', new Date().toISOString().split('T')[0]),
  });

  return async (state: { query: string }): Promise<{ bundle: EvidenceBundle }> => {
    // Phase 1: ReAct collection
    const reactResult = await reactAgent.invoke({
      messages: [new HumanMessage(state.query)],
    });

    const rawData = reactResult.messages
      .map((m: { content: unknown }) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n\n');

    // Phase 2: Compaction
    const bundle = await compactWithRetry(model, state.query, rawData);

    return { bundle };
  };
}

// compactWithRetry stays exactly the same (no dispatchCustomEvent)
```

**Step 2: Refactor synthesizer.node.ts — remove `dispatchCustomEvent` calls**

Remove the import and both `dispatchCustomEvent` calls. Keep the LLM call + parse + retry logic.

```typescript
// apps/api/src/agent/nodes/synthesizer.node.ts — remove dispatchCustomEvent import and calls
// Everything else stays the same. The function signature becomes:
export function createSynthesizerNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
  }): Promise<{ analysis: AnalysisResult }> => {
    // ... same LLM call + parse + retry logic, just without dispatchCustomEvent calls ...
  };
}
```

**Step 3: Refactor writer.node.ts — remove `dispatchCustomEvent` calls (including `pipeline_response`)**

Remove the import and all `dispatchCustomEvent` calls. The orchestrator captures the return value directly now.

```typescript
// apps/api/src/agent/nodes/writer.node.ts — remove dispatchCustomEvent import and all calls
// The function returns { response: AgentResponseV2 } as before.
```

**Step 4: Run existing node tests to verify nothing breaks**

Run: `npx nx test api --testPathPattern='nodes/' --no-coverage`
Expected: All existing node tests PASS (they mock the nodes anyway)

**Step 5: Commit**

```bash
git add apps/api/src/agent/nodes/
git commit -m "refactor(agent): strip dispatchCustomEvent from pipeline nodes

Nodes become pure data transformers. Event emission moves to the
orchestrator, enabling per-stage failure recovery."
```

---

## Task 4: Write failing tests for per-stage failure recovery

**Files:**

- Modify: `apps/api/src/agent/orchestrator.service.spec.ts`

**Step 1: Add test fixtures and helper at the top of the existing spec**

Add shared test fixtures after the existing mock setup. These are reused across the new tests:

```typescript
// Add after the existing mock declarations, before describe()

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
```

**Step 2: Import required types and mock node factories**

```typescript
// Update imports at top of spec file
import type {
  PipelineConfig,
  EvidenceBundle,
  AnalysisResult,
  AgentResponseV2,
} from '@voxpopuli/shared-types';
import { createRetrieverNode } from './nodes/retriever.node';
import { createSynthesizerNode } from './nodes/synthesizer.node';
import { createWriterNode } from './nodes/writer.node';
```

**Step 3: Write failing tests for recovery scenarios**

```typescript
describe('per-stage failure recovery', () => {
  const config: PipelineConfig = {
    useMultiAgent: true,
    providerMap: {},
    tokenBudgets: { retriever: 2000, synthesizer: 1500, synthesizerInput: 4000, writer: 1000 },
    timeout: 30000,
  };

  it('should retry synthesizer once on failure then succeed', async () => {
    const mockRetriever = jest.fn().mockResolvedValue({ bundle: mockBundle });
    const mockSynthesizer = jest
      .fn()
      .mockRejectedValueOnce(new Error('LLM parse error'))
      .mockResolvedValueOnce({ analysis: mockAnalysis });
    const mockWriter = jest.fn().mockResolvedValue({ response: mockResponseV2 });

    (createRetrieverNode as jest.Mock).mockReturnValue(mockRetriever);
    (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
    (createWriterNode as jest.Mock).mockReturnValue(mockWriter);

    const events = [];
    for await (const event of service.runStream('test query', config)) {
      events.push(event);
    }

    expect(mockSynthesizer).toHaveBeenCalledTimes(2);
    expect(mockWriter).toHaveBeenCalledTimes(1);
    const completeEvent = events.find((e) => e.kind === 'complete');
    expect(completeEvent).toBeDefined();
  });

  it('should fall back to legacy after synthesizer retry fails', async () => {
    const mockRetriever = jest.fn().mockResolvedValue({ bundle: mockBundle });
    const mockSynthesizer = jest.fn().mockRejectedValue(new Error('LLM down'));

    (createRetrieverNode as jest.Mock).mockReturnValue(mockRetriever);
    (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);

    const mockLegacyEvents = (async function* () {
      yield {
        kind: 'complete' as const,
        response: {
          answer: 'legacy',
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
    (agentService.runStream as jest.Mock).mockReturnValue(mockLegacyEvents);

    const events = [];
    for await (const event of service.runWithFallback('test query', config)) {
      events.push(event);
    }

    expect(mockSynthesizer).toHaveBeenCalledTimes(2);
    expect(agentService.runStream).toHaveBeenCalledWith('test query');
  });

  it('should retry writer once on failure then succeed', async () => {
    const mockRetriever = jest.fn().mockResolvedValue({ bundle: mockBundle });
    const mockSynthesizer = jest.fn().mockResolvedValue({ analysis: mockAnalysis });
    const mockWriter = jest
      .fn()
      .mockRejectedValueOnce(new Error('Writer parse error'))
      .mockResolvedValueOnce({ response: mockResponseV2 });

    (createRetrieverNode as jest.Mock).mockReturnValue(mockRetriever);
    (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
    (createWriterNode as jest.Mock).mockReturnValue(mockWriter);

    const events = [];
    for await (const event of service.runStream('test query', config)) {
      events.push(event);
    }

    expect(mockWriter).toHaveBeenCalledTimes(2);
    const completeEvent = events.find((e) => e.kind === 'complete');
    expect(completeEvent).toBeDefined();
  });

  it('should build fallback response when writer retry also fails', async () => {
    const mockRetriever = jest.fn().mockResolvedValue({ bundle: mockBundle });
    const mockSynthesizer = jest.fn().mockResolvedValue({ analysis: mockAnalysis });
    const mockWriter = jest.fn().mockRejectedValue(new Error('Writer broken'));

    (createRetrieverNode as jest.Mock).mockReturnValue(mockRetriever);
    (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
    (createWriterNode as jest.Mock).mockReturnValue(mockWriter);

    const events = [];
    for await (const event of service.runStream('test query', config)) {
      events.push(event);
    }

    expect(mockWriter).toHaveBeenCalledTimes(2);
    const completeEvent = events.find((e) => e.kind === 'complete') as {
      kind: 'complete';
      response: { answer: string; meta: { error?: boolean } };
    };
    expect(completeEvent).toBeDefined();
    // Fallback response should contain the analysis summary
    expect(completeEvent.response.answer).toContain('Test summary');
    expect(completeEvent.response.meta.error).toBe(true);
  });

  it('should never re-run retriever on downstream failure', async () => {
    const mockRetriever = jest.fn().mockResolvedValue({ bundle: mockBundle });
    const mockSynthesizer = jest.fn().mockRejectedValue(new Error('synth fail'));
    const mockWriter = jest.fn();

    (createRetrieverNode as jest.Mock).mockReturnValue(mockRetriever);
    (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
    (createWriterNode as jest.Mock).mockReturnValue(mockWriter);

    const mockLegacyEvents = (async function* () {
      yield {
        kind: 'complete' as const,
        response: {
          answer: 'legacy',
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
    (agentService.runStream as jest.Mock).mockReturnValue(mockLegacyEvents);

    const events = [];
    for await (const event of service.runWithFallback('test query', config)) {
      events.push(event);
    }

    // Retriever called exactly once, never re-run
    expect(mockRetriever).toHaveBeenCalledTimes(1);
  });

  it('should emit pipeline error events on stage failures', async () => {
    const mockRetriever = jest.fn().mockResolvedValue({ bundle: mockBundle });
    const mockSynthesizer = jest.fn().mockResolvedValue({ analysis: mockAnalysis });
    const mockWriter = jest.fn().mockRejectedValue(new Error('Writer broken'));

    (createRetrieverNode as jest.Mock).mockReturnValue(mockRetriever);
    (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
    (createWriterNode as jest.Mock).mockReturnValue(mockWriter);

    const events = [];
    for await (const event of service.runStream('test query', config)) {
      events.push(event);
    }

    const errorEvents = events.filter((e) => e.kind === 'pipeline' && e.event.status === 'error');
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].event.stage).toBe('writer');
  });
});
```

**Step 4: Run tests to verify they fail**

Run: `npx nx test api --testPathPattern='orchestrator.service' --no-coverage`
Expected: All 6 new tests FAIL (the orchestrator still uses StateGraph, not direct node calls)

**Step 5: Commit**

```bash
git add apps/api/src/agent/orchestrator.service.spec.ts
git commit -m "test(agent): RED — add failing tests for per-stage failure recovery

Tests cover: synthesizer retry + success, synthesizer retry + legacy fallback,
writer retry + success, writer retry + fallback response, retriever never re-run,
and error event emission."
```

---

## Task 5: Refactor `runStream` to call nodes directly with per-stage recovery

**Files:**

- Modify: `apps/api/src/agent/orchestrator.service.ts`

**Step 1: Replace the LangGraph StateGraph with direct sequential node calls**

```typescript
// apps/api/src/agent/orchestrator.service.ts
import { Injectable, Logger } from '@nestjs/common';
import type {
  PipelineConfig,
  PipelineEvent,
  AgentResponseV2,
  AgentStep,
  AgentResponse,
  EvidenceBundle,
  AnalysisResult,
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

// ---------------------------------------------------------------------------
// Stream event types
// ---------------------------------------------------------------------------

/** Discriminated union of events yielded by the pipeline. */
export type PipelineStreamEvent =
  | { kind: 'pipeline'; event: PipelineEvent }
  | { kind: 'step'; step: AgentStep }
  | { kind: 'token'; content: string }
  | { kind: 'complete'; response: AgentResponse };

/**
 * Orchestrates the multi-agent pipeline with per-stage failure recovery.
 *
 * Recovery matrix:
 * - Retriever fails → bubble to runWithFallback → legacy AgentService
 * - Synthesizer fails → retry once, then bubble → legacy
 * - Writer fails → retry once, then buildFallbackResponse
 *
 * Key rule: never re-run the Retriever on downstream failure.
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

  /**
   * Run the pipeline with automatic fallback to legacy agent on failure.
   * Catches retriever failures and synthesizer failures (after retry).
   */
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

  /**
   * Run the pipeline by calling each node directly with per-stage error handling.
   *
   * Retriever failures bubble up (caught by runWithFallback).
   * Synthesizer retries once, then bubbles up.
   * Writer retries once, then falls back to buildFallbackResponse.
   */
  async *runStream(query: string, config: PipelineConfig): AsyncGenerator<PipelineStreamEvent> {
    const startTime = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const activeProvider =
      config.providerMap.retriever ??
      config.providerMap.synthesizer ??
      config.providerMap.writer ??
      this.llm.getProviderName();

    const getModel = (stage: 'retriever' | 'synthesizer' | 'writer') =>
      this.llm.getModel(config.providerMap[stage]);

    const tools = createAgentTools(this.hn, this.chunker);
    const retrieverFn = createRetrieverNode(getModel('retriever'), tools);
    const synthesizerFn = createSynthesizerNode(getModel('synthesizer'));
    const writerFn = createWriterNode(getModel('writer'));

    // Helper to emit pipeline events
    const elapsed = () => Date.now() - startTime;

    // ── Stage 1: Retriever ──────────────────────────────────────────────
    // Failures bubble to runWithFallback → legacy agent
    yield {
      kind: 'pipeline',
      event: {
        stage: 'retriever',
        status: 'started',
        detail: `Searching HN for "${query}"...`,
        elapsed: elapsed(),
      },
    };

    const { bundle } = await retrieverFn({ query });

    yield {
      kind: 'pipeline',
      event: {
        stage: 'retriever',
        status: 'done',
        detail: `${bundle.themes.length} themes from ${bundle.allSources.length} sources`,
        elapsed: elapsed(),
      },
    };

    // ── Stage 2: Synthesizer ────────────────────────────────────────────
    // Retry once, then bubble to runWithFallback → legacy agent
    yield {
      kind: 'pipeline',
      event: {
        stage: 'synthesizer',
        status: 'started',
        detail: `Analyzing ${bundle.themes.length} themes...`,
        elapsed: elapsed(),
      },
    };

    let analysis: AnalysisResult;
    try {
      ({ analysis } = await synthesizerFn({ query, bundle }));
    } catch (firstError) {
      this.logger.warn(
        `Synthesizer failed, retrying: ${
          firstError instanceof Error ? firstError.message : firstError
        }`,
      );
      yield {
        kind: 'pipeline',
        event: {
          stage: 'synthesizer',
          status: 'error',
          detail: 'Retrying analysis...',
          elapsed: elapsed(),
        },
      };
      // Retry once with same bundle — throws on second failure (caught by runWithFallback)
      ({ analysis } = await synthesizerFn({ query, bundle }));
    }

    yield {
      kind: 'pipeline',
      event: {
        stage: 'synthesizer',
        status: 'done',
        detail: `${analysis.insights.length} insights, confidence: ${analysis.confidence}`,
        elapsed: elapsed(),
      },
    };

    // ── Stage 3: Writer ─────────────────────────────────────────────────
    // Retry once, then buildFallbackResponse (does NOT bubble)
    yield {
      kind: 'pipeline',
      event: {
        stage: 'writer',
        status: 'started',
        detail: 'Composing headline and sections...',
        elapsed: elapsed(),
      },
    };

    let writerResponse: AgentResponseV2 | undefined;
    try {
      ({ response: writerResponse } = await writerFn({ query, bundle, analysis }));
    } catch (firstError) {
      this.logger.warn(
        `Writer failed, retrying: ${firstError instanceof Error ? firstError.message : firstError}`,
      );
      yield {
        kind: 'pipeline',
        event: {
          stage: 'writer',
          status: 'error',
          detail: 'Retrying composition...',
          elapsed: elapsed(),
        },
      };
      try {
        ({ response: writerResponse } = await writerFn({ query, bundle, analysis }));
      } catch (retryError) {
        this.logger.warn(
          `Writer retry failed, using fallback response: ${
            retryError instanceof Error ? retryError.message : retryError
          }`,
        );
        yield {
          kind: 'pipeline',
          event: {
            stage: 'writer',
            status: 'error',
            detail: 'Using fallback response from analysis',
            elapsed: elapsed(),
          },
        };
      }
    }

    // ── Emit final response ─────────────────────────────────────────────
    if (writerResponse) {
      yield {
        kind: 'pipeline',
        event: {
          stage: 'writer',
          status: 'done',
          detail: `${writerResponse.sections.length} sections, ${writerResponse.sources.length} sources`,
          elapsed: elapsed(),
        },
      };

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
            totalInputTokens,
            totalOutputTokens,
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
    } else {
      // Writer failed after retry — use fallback
      yield {
        kind: 'complete',
        response: buildFallbackResponse(analysis, bundle, {
          provider: activeProvider,
          durationMs: elapsed(),
          totalInputTokens,
          totalOutputTokens,
        }),
      };
    }
  }
}
```

**Step 2: Run all tests to verify they pass**

Run: `npx nx test api --testPathPattern='orchestrator.service|fallback-response' --no-coverage`
Expected: ALL tests PASS (existing + new recovery tests)

**Step 3: Commit**

```bash
git add apps/api/src/agent/orchestrator.service.ts
git commit -m "feat(agent): GREEN — per-stage failure recovery in OrchestratorService

Replace LangGraph StateGraph with direct sequential node calls.
Orchestrator now owns event emission and handles failures per stage:
- Retriever: bubbles to runWithFallback → legacy agent
- Synthesizer: retry once, then bubble → legacy
- Writer: retry once, then buildFallbackResponse from AnalysisResult

Never re-runs Retriever on downstream failure.

Closes AI-290"
```

---

## Task 6: Update existing orchestrator tests for new architecture

**Files:**

- Modify: `apps/api/src/agent/orchestrator.service.spec.ts`

**Step 1: Update existing tests to work with direct node calls instead of graph events**

The existing `'should stream pipeline events on success'` test mocks `mockGraphStreamEvents` (the LangGraph graph). Since we no longer use the graph, update it to mock node factories instead.

```typescript
it('should stream pipeline events on success', async () => {
  const mockRetriever = jest.fn().mockResolvedValue({ bundle: mockBundle });
  const mockSynthesizer = jest.fn().mockResolvedValue({ analysis: mockAnalysis });
  const mockWriter = jest.fn().mockResolvedValue({ response: mockResponseV2 });

  (createRetrieverNode as jest.Mock).mockReturnValue(mockRetriever);
  (createSynthesizerNode as jest.Mock).mockReturnValue(mockSynthesizer);
  (createWriterNode as jest.Mock).mockReturnValue(mockWriter);

  const config: PipelineConfig = {
    useMultiAgent: true,
    providerMap: {},
    tokenBudgets: { retriever: 2000, synthesizer: 1500, synthesizerInput: 4000, writer: 1000 },
    timeout: 30000,
  };

  const events = [];
  for await (const event of service.runStream('test query', config)) {
    events.push(event);
  }

  const pipelineEvents = events.filter((e) => e.kind === 'pipeline');
  const completeEvents = events.filter((e) => e.kind === 'complete');
  // started + done for each of 3 stages = 6 pipeline events
  expect(pipelineEvents.length).toBe(6);
  expect(completeEvents.length).toBe(1);
});
```

Also update the `'should fall back to legacy agent on pipeline error'` test to mock the retriever failing:

```typescript
it('should fall back to legacy agent on retriever error', async () => {
  const mockRetriever = jest.fn().mockRejectedValue(new Error('Retriever kaboom'));
  (createRetrieverNode as jest.Mock).mockReturnValue(mockRetriever);

  // ... rest stays the same, just remove mockGraphStreamEvents references ...
});
```

Remove the `mockGraphStreamEvents` variable and the `@langchain/langgraph` mock (the graph is no longer used in the orchestrator). Keep the node factory mocks.

**Step 2: Clean up unused imports and mocks**

Remove the `StateGraph`, `Annotation`, `START`, `END` mock from the `@langchain/langgraph` jest.mock block. The orchestrator no longer imports these.

**Step 3: Run full test suite**

Run: `npx nx test api --testPathPattern='orchestrator.service|fallback-response' --no-coverage`
Expected: ALL tests PASS

**Step 4: Run broader test suite to catch regressions**

Run: `npx nx test api --no-coverage`
Expected: ALL tests PASS

**Step 5: Commit**

```bash
git add apps/api/src/agent/orchestrator.service.spec.ts
git commit -m "test(agent): update orchestrator tests for direct node call architecture"
```

---

## Task 7: Final verification and lint

**Step 1: Run linter**

Run: `npx nx affected:lint`
Expected: No errors

**Step 2: Run full test suite**

Run: `npx nx test api --no-coverage`
Expected: ALL tests PASS

**Step 3: Verify the build compiles**

Run: `npx nx build api`
Expected: Build succeeds

**Step 4: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "chore: lint fixes for orchestrator failure recovery"
```

---

## Summary of Changes

| File                                              | Change                                         |
| ------------------------------------------------- | ---------------------------------------------- |
| `apps/api/src/agent/fallback-response.ts`         | NEW — `buildFallbackResponse()` pure function  |
| `apps/api/src/agent/fallback-response.spec.ts`    | NEW — 6 tests for fallback response            |
| `apps/api/src/agent/nodes/retriever.node.ts`      | MODIFY — remove `dispatchCustomEvent` calls    |
| `apps/api/src/agent/nodes/synthesizer.node.ts`    | MODIFY — remove `dispatchCustomEvent` calls    |
| `apps/api/src/agent/nodes/writer.node.ts`         | MODIFY �� remove `dispatchCustomEvent` calls   |
| `apps/api/src/agent/orchestrator.service.ts`      | MODIFY — direct node calls, per-stage recovery |
| `apps/api/src/agent/orchestrator.service.spec.ts` | MODIFY — add 6 recovery tests, update existing |
