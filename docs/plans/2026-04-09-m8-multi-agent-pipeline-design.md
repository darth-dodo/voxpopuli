# M8: Multi-Agent Pipeline Design

**Date:** 2026-04-09
**Status:** Approved
**Branch:** feature/v2-multi-agent-spec
**Linear Milestone:** M8: Multi-Agent Pipeline

## Summary

Replace the single ReAct agent with a Retriever → Synthesizer → Writer pipeline using LangGraph for orchestration and Zod for runtime validation at every boundary. The existing AgentService stays untouched as the legacy fallback.

## Key Decisions

| Decision               | Choice                                                     | Rationale                                                         |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Orchestrator framework | LangGraph `StateGraph`                                     | Built-in state management, streaming events, sub-graph support    |
| Retriever ReAct loop   | LangGraph `createReactAgent` (fresh, not wrapping legacy)  | Native LangGraph sub-graph with tool support                      |
| Compaction             | Separate node in Retriever sub-graph                       | Independently testable, retryable without re-running ReAct        |
| State shape            | Flat accumulator, Zod-validated                            | Pipeline is sequential — no branching, no stale data risk         |
| Type system            | Zod schemas everywhere (runtime + compile-time)            | Runtime validation of LLM output, structured retry error messages |
| SSE streaming          | Stage events + Retriever inner steps + Writer token stream | Best UX — users see tool usage, stage progress, and live prose    |
| Failure recovery       | Strip fences → Zod parse → retry once → legacy fallback    | KISS/YAGNI — one fallback path, add more when evals prove need    |
| Legacy path            | Existing `AgentService` untouched                          | Zero blast radius on working code                                 |

## Architecture

### Top-Level Pipeline (LangGraph StateGraph)

```
Query → OrchestratorService (LangGraph StateGraph)
  ├── Node: "retriever" (LangGraph sub-graph)
  │     ├── Sub-node: "react" (createReactAgent — tools: search_hn, get_story, get_comments)
  │     └── Sub-node: "compactor" (single LLM call → EvidenceBundle)
  ├── Node: "synthesizer" (single LLM call → AnalysisResult)
  └── Node: "writer" (single LLM call with token streaming → AgentResponseV2)
```

### State Shape

Flat accumulator — every field Zod-validated:

```typescript
const PipelineState = z.object({
  query: z.string(),
  bundle: EvidenceBundleSchema.optional(),
  analysis: AnalysisResultSchema.optional(),
  response: AgentResponseV2Schema.optional(),
  events: z.array(PipelineEventSchema),
  error: z.string().optional(),
});
```

### Retriever Sub-Graph

Two nodes:

1. **react** — `createReactAgent()` with existing HN tools (`search_hn`, `get_story`, `get_comments`). Max 8 iterations.
2. **compactor** — Single LLM call: raw HN data → `EvidenceBundle` (3-6 ThemeGroups, ~600 tokens). Zod-validated output.

Critical boundary: No raw HN data crosses into the Synthesizer.

### Synthesizer Node

Single-pass structured output. Input: `EvidenceBundle`. Output: `AnalysisResult` (3-5 insights, contradictions, confidence, gaps). Zod-validated.

### Writer Node

Single-pass with token streaming. Input: `AnalysisResult` + `EvidenceBundle` (citation lookup only). Output: `AgentResponseV2` (headline, context, 2-4 sections, bottom line). Uses `model.stream()` for token-by-token SSE.

Critical constraint: Writer is a composer, not an analyst. System prompt prohibits re-interpreting evidence or overriding Synthesizer confidence.

### SSE Streaming

Three event levels via LangGraph `streamEvents({ version: 'v2' })`:

- **Retriever inner steps**: `on_tool_start`/`on_tool_end` → step events (tool calls, observations)
- **Stage transitions**: `on_chain_end` at node boundaries → `PipelineEvent` (started/done per stage)
- **Writer token stream**: `on_chat_model_stream` from writer node → token events

### Failure Recovery

KISS — one fallback path:

| Failure                            | Recovery                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Any node: LLM returns invalid JSON | Strip markdown fences → `JSON.parse` → `schema.safeParse()` → retry once with Zod error details in prompt |
| Retry fails                        | Fall back to legacy `AgentService`                                                                        |

Deferred until eval data proves need: `buildFallbackResponse()` from AnalysisResult, dry-well circuit breaker, bundle size guard/trimming.

## Zod Schemas

### Evidence Types (`libs/shared-types/src/evidence.types.ts`)

```typescript
EvidenceItemSchema = z.object({
  sourceId: z.number(),
  text: z.string(),
  type: z.enum(['evidence', 'anecdote', 'opinion', 'consensus']),
  relevance: z.number().min(0).max(1),
});

ThemeGroupSchema = z.object({
  label: z.string(),
  items: z.array(EvidenceItemSchema).min(1),
});

EvidenceBundleSchema = z.object({
  query: z.string(),
  themes: z.array(ThemeGroupSchema).min(1).max(6),
  allSources: z.array(SourceMetadataSchema),
  totalSourcesScanned: z.number(),
  tokenCount: z.number(),
});
```

### Analysis Types (`libs/shared-types/src/analysis.types.ts`)

```typescript
InsightSchema = z.object({
  claim: z.string(),
  reasoning: z.string(),
  evidenceStrength: z.enum(['strong', 'moderate', 'weak']),
  themeIndices: z.array(z.number()),
});

ContradictionSchema = z.object({
  claim: z.string(),
  counterClaim: z.string(),
  sourceIds: z.array(z.number()),
});

AnalysisResultSchema = z.object({
  summary: z.string(),
  insights: z.array(InsightSchema).min(1).max(5),
  contradictions: z.array(ContradictionSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  gaps: z.array(z.string()),
});
```

### Response Types v2 (`libs/shared-types/src/response.types.ts`)

```typescript
ResponseSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  citedSources: z.array(z.number()),
});

AgentResponseV2Schema = z.object({
  headline: z.string(),
  context: z.string(),
  sections: z.array(ResponseSectionSchema).min(2).max(4),
  bottomLine: z.string(),
  sources: z.array(AgentSourceSchema),
});
```

### Pipeline Types (`libs/shared-types/src/pipeline.types.ts`)

```typescript
PipelineStageSchema = z.enum(['retriever', 'synthesizer', 'writer']);
StageStatusSchema = z.enum(['started', 'progress', 'done', 'error']);

PipelineEventSchema = z.object({
  stage: PipelineStageSchema,
  status: StageStatusSchema,
  detail: z.string(),
  elapsed: z.number(),
});

PipelineConfigSchema = z.object({
  useMultiAgent: z.boolean().default(false),
  providerMap: z
    .object({
      retriever: z.string().optional(),
      synthesizer: z.string().optional(),
      writer: z.string().optional(),
    })
    .default({}),
  tokenBudgets: z
    .object({
      retriever: z.number().default(2000),
      synthesizer: z.number().default(1500),
      synthesizerInput: z.number().default(4000),
      writer: z.number().default(1000),
    })
    .default({}),
  timeout: z.number().default(30000),
});
```

## File Layout

### New Files

```
apps/api/src/agent/
  ├── orchestrator.service.ts        # LangGraph StateGraph, runStream(), runWithFallback()
  ├── nodes/
  │     ├── retriever.node.ts        # LangGraph sub-graph (react + compactor)
  │     ├── synthesizer.node.ts      # Single LLM call → AnalysisResult
  │     └── writer.node.ts           # Single LLM call with token streaming → AgentResponseV2
  └── prompts/
        ├── retriever.prompt.ts      # ReAct collection prompt
        ├── compactor.prompt.ts      # Raw data → EvidenceBundle
        ├── synthesizer.prompt.ts    # Bundle → AnalysisResult
        └── writer.prompt.ts         # Analysis → prose (with citation rules)

libs/shared-types/src/
  ├── evidence.types.ts              # EvidenceItem, ThemeGroup, EvidenceBundle
  ├── analysis.types.ts              # Insight, Contradiction, AnalysisResult
  ├── response.types.ts              # UPDATED — add AgentResponseV2, ResponseSection
  └── pipeline.types.ts              # PipelineConfig, PipelineEvent, PipelineResult, PipelineState
```

### Modified Files

- `apps/api/src/agent/agent.module.ts` — register OrchestratorService
- `apps/api/src/rag/rag.controller.ts` — pipeline SSE path keyed on `useMultiAgent`
- `libs/shared-types/src/index.ts` — barrel exports for new types
- `package.json` — add `@langchain/langgraph`

### Unchanged Files

- `agent.service.ts`, `tools.ts`, `system-prompt.ts`, `trust.ts`, `partial-response.ts`
- All other modules (hn, llm, cache, chunker, tts)

## Frontend Integration

- `RagService` parses three new SSE event types: `pipeline`, `step` (from retriever), `token` (from writer)
- `AgentStepsComponent` gets pipeline mode: three-stage timeline with retriever inner steps and writer token streaming
- Feature detection by event shape (not flag): `pipeline` events → pipeline mode, legacy events → legacy mode
- When `useMultiAgent: false`, zero frontend changes

## Execution Order

1. All Zod schemas in shared-types (Epic 8.1)
2. Orchestrator skeleton with stub nodes
3. Nodes one by one: Retriever → Synthesizer → Writer, tests alongside each
4. Wire to RagController with feature flag
5. Frontend: RagService SSE parsing, AgentStepsComponent pipeline mode
6. A/B eval comparison via eval harness
