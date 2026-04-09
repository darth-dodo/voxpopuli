# M8: Multi-Agent Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single ReAct agent with a LangGraph-orchestrated Retriever → Synthesizer → Writer pipeline with Zod-validated state and three-level SSE streaming.

**Architecture:** LangGraph `StateGraph` as top-level pipeline. Retriever is a sub-graph (ReAct + compactor nodes). Synthesizer and Writer are single-pass LLM nodes. All inter-node data validated through Zod schemas. Existing `AgentService` untouched as legacy fallback.

**Tech Stack:** `@langchain/langgraph` (StateGraph, createReactAgent, Annotation, streamEvents v2), Zod 4.x, NestJS 11, Angular 21, existing `@langchain/*` providers.

**Design doc:** `docs/plans/2026-04-09-m8-multi-agent-pipeline-design.md`

**Linear issues:** AI-280 (types), AI-285 (agents), AI-293 (tests), AI-298 (frontend), AI-301 (rollout)

---

## Task 1: Install `@langchain/langgraph`

**Files:**

- Modify: `package.json`

**Step 1: Install the package**

Run: `npm install @langchain/langgraph`
Expected: Package added to dependencies.

**Step 2: Verify import works**

Run: `node -e "require('@langchain/langgraph')"`
Expected: No errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @langchain/langgraph dependency for M8 pipeline"
```

---

## Task 2: Define Evidence Types (Zod schemas)

**Files:**

- Create: `libs/shared-types/src/lib/evidence.types.ts`
- Modify: `libs/shared-types/src/index.ts`
- Test: `libs/shared-types/src/lib/evidence.types.spec.ts`

**Step 1: Write the failing test**

```typescript
// libs/shared-types/src/lib/evidence.types.spec.ts
import {
  EvidenceItemSchema,
  ThemeGroupSchema,
  EvidenceBundleSchema,
  SourceMetadataSchema,
} from './evidence.types';

describe('Evidence Types', () => {
  describe('EvidenceItemSchema', () => {
    it('should parse a valid evidence item', () => {
      const result = EvidenceItemSchema.safeParse({
        sourceId: 12345,
        text: 'React Server Components improve TTFB by 40%',
        type: 'evidence',
        relevance: 0.85,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      const result = EvidenceItemSchema.safeParse({
        sourceId: 1,
        text: 'test',
        type: 'rumor',
        relevance: 0.5,
      });
      expect(result.success).toBe(false);
    });

    it('should reject relevance out of range', () => {
      const result = EvidenceItemSchema.safeParse({
        sourceId: 1,
        text: 'test',
        type: 'opinion',
        relevance: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SourceMetadataSchema', () => {
    it('should parse a valid source', () => {
      const result = SourceMetadataSchema.safeParse({
        storyId: 12345,
        title: 'Show HN: My new project',
        url: 'https://example.com',
        author: 'pg',
        points: 250,
        commentCount: 45,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ThemeGroupSchema', () => {
    it('should require at least one item', () => {
      const result = ThemeGroupSchema.safeParse({
        label: 'Empty theme',
        items: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('EvidenceBundleSchema', () => {
    it('should parse a complete bundle', () => {
      const result = EvidenceBundleSchema.safeParse({
        query: 'React vs Vue in 2026',
        themes: [
          {
            label: 'Performance',
            items: [{ sourceId: 1, text: 'React is faster', type: 'evidence', relevance: 0.9 }],
          },
        ],
        allSources: [
          { storyId: 1, title: 'Test', url: '', author: 'a', points: 10, commentCount: 0 },
        ],
        totalSourcesScanned: 15,
        tokenCount: 580,
      });
      expect(result.success).toBe(true);
    });

    it('should reject more than 6 themes', () => {
      const themes = Array.from({ length: 7 }, (_, i) => ({
        label: `Theme ${i}`,
        items: [{ sourceId: i, text: 'x', type: 'evidence' as const, relevance: 0.5 }],
      }));
      const result = EvidenceBundleSchema.safeParse({
        query: 'test',
        themes,
        allSources: [],
        totalSourcesScanned: 0,
        tokenCount: 0,
      });
      expect(result.success).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx nx test shared-types --testPathPattern=evidence.types`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```typescript
// libs/shared-types/src/lib/evidence.types.ts
import { z } from 'zod';

/** Metadata for a HN story used as a source. */
export const SourceMetadataSchema = z.object({
  storyId: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  points: z.number(),
  commentCount: z.number(),
});
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;

/** A single piece of evidence extracted from HN data. */
export const EvidenceItemSchema = z.object({
  sourceId: z.number(),
  text: z.string(),
  type: z.enum(['evidence', 'anecdote', 'opinion', 'consensus']),
  relevance: z.number().min(0).max(1),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/** A thematic grouping of evidence items. */
export const ThemeGroupSchema = z.object({
  label: z.string(),
  items: z.array(EvidenceItemSchema).min(1),
});
export type ThemeGroup = z.infer<typeof ThemeGroupSchema>;

/** Compacted evidence bundle produced by the Retriever. */
export const EvidenceBundleSchema = z.object({
  query: z.string(),
  themes: z.array(ThemeGroupSchema).min(1).max(6),
  allSources: z.array(SourceMetadataSchema),
  totalSourcesScanned: z.number(),
  tokenCount: z.number(),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
```

**Step 4: Update barrel export**

Add to `libs/shared-types/src/index.ts`:

```typescript
export * from './lib/evidence.types';
```

**Step 5: Run test to verify it passes**

Run: `npx nx test shared-types --testPathPattern=evidence.types`
Expected: PASS — all 6 tests green.

**Step 6: Commit**

```bash
git add libs/shared-types/src/lib/evidence.types.ts libs/shared-types/src/lib/evidence.types.spec.ts libs/shared-types/src/index.ts
git commit -m "feat(shared-types): add evidence Zod schemas (EvidenceItem, ThemeGroup, EvidenceBundle)"
```

---

## Task 3: Define Analysis Types (Zod schemas)

**Files:**

- Create: `libs/shared-types/src/lib/analysis.types.ts`
- Modify: `libs/shared-types/src/index.ts`
- Test: `libs/shared-types/src/lib/analysis.types.spec.ts`

**Step 1: Write the failing test**

```typescript
// libs/shared-types/src/lib/analysis.types.spec.ts
import { InsightSchema, ContradictionSchema, AnalysisResultSchema } from './analysis.types';

describe('Analysis Types', () => {
  describe('InsightSchema', () => {
    it('should parse a valid insight', () => {
      const result = InsightSchema.safeParse({
        claim: 'React dominates in enterprise adoption',
        reasoning: 'Multiple HN threads cite Fortune 500 usage',
        evidenceStrength: 'strong',
        themeIndices: [0, 2],
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid evidenceStrength', () => {
      const result = InsightSchema.safeParse({
        claim: 'test',
        reasoning: 'test',
        evidenceStrength: 'very strong',
        themeIndices: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ContradictionSchema', () => {
    it('should parse a valid contradiction', () => {
      const result = ContradictionSchema.safeParse({
        claim: 'React is fastest',
        counterClaim: 'Svelte benchmarks higher',
        sourceIds: [123, 456],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('AnalysisResultSchema', () => {
    it('should parse a complete analysis', () => {
      const result = AnalysisResultSchema.safeParse({
        summary: 'React leads in adoption, Vue in satisfaction',
        insights: [
          {
            claim: 'React leads adoption',
            reasoning: 'Most cited in job postings',
            evidenceStrength: 'strong',
            themeIndices: [0],
          },
        ],
        contradictions: [],
        confidence: 'medium',
        gaps: ['No data on Svelte adoption'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject more than 5 insights', () => {
      const insights = Array.from({ length: 6 }, (_, i) => ({
        claim: `Claim ${i}`,
        reasoning: 'reason',
        evidenceStrength: 'moderate' as const,
        themeIndices: [0],
      }));
      const result = AnalysisResultSchema.safeParse({
        summary: 'test',
        insights,
        contradictions: [],
        confidence: 'high',
        gaps: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid confidence level', () => {
      const result = AnalysisResultSchema.safeParse({
        summary: 'test',
        insights: [{ claim: 'x', reasoning: 'y', evidenceStrength: 'weak', themeIndices: [] }],
        contradictions: [],
        confidence: 'very high',
        gaps: [],
      });
      expect(result.success).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx nx test shared-types --testPathPattern=analysis.types`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```typescript
// libs/shared-types/src/lib/analysis.types.ts
import { z } from 'zod';

/** A single insight derived from evidence analysis. */
export const InsightSchema = z.object({
  claim: z.string(),
  reasoning: z.string(),
  evidenceStrength: z.enum(['strong', 'moderate', 'weak']),
  themeIndices: z.array(z.number()),
});
export type Insight = z.infer<typeof InsightSchema>;

/** A contradiction found between sources. */
export const ContradictionSchema = z.object({
  claim: z.string(),
  counterClaim: z.string(),
  sourceIds: z.array(z.number()),
});
export type Contradiction = z.infer<typeof ContradictionSchema>;

/** Structured analysis produced by the Synthesizer. */
export const AnalysisResultSchema = z.object({
  summary: z.string(),
  insights: z.array(InsightSchema).min(1).max(5),
  contradictions: z.array(ContradictionSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  gaps: z.array(z.string()),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
```

**Step 4: Update barrel export**

Add to `libs/shared-types/src/index.ts`:

```typescript
export * from './lib/analysis.types';
```

**Step 5: Run test to verify it passes**

Run: `npx nx test shared-types --testPathPattern=analysis.types`
Expected: PASS — all 5 tests green.

**Step 6: Commit**

```bash
git add libs/shared-types/src/lib/analysis.types.ts libs/shared-types/src/lib/analysis.types.spec.ts libs/shared-types/src/index.ts
git commit -m "feat(shared-types): add analysis Zod schemas (Insight, Contradiction, AnalysisResult)"
```

---

## Task 4: Define Response v2 and Pipeline Types (Zod schemas)

**Files:**

- Create: `libs/shared-types/src/lib/response-v2.types.ts`
- Create: `libs/shared-types/src/lib/pipeline.types.ts`
- Modify: `libs/shared-types/src/index.ts`
- Test: `libs/shared-types/src/lib/response-v2.types.spec.ts`
- Test: `libs/shared-types/src/lib/pipeline.types.spec.ts`

**Step 1: Write the failing tests**

```typescript
// libs/shared-types/src/lib/response-v2.types.spec.ts
import { ResponseSectionSchema, AgentResponseV2Schema } from './response-v2.types';

describe('Response V2 Types', () => {
  describe('ResponseSectionSchema', () => {
    it('should parse a valid section', () => {
      const result = ResponseSectionSchema.safeParse({
        heading: 'Enterprise Adoption',
        body: 'React dominates enterprise usage according to multiple sources.',
        citedSources: [123, 456],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('AgentResponseV2Schema', () => {
    it('should parse a complete v2 response', () => {
      const result = AgentResponseV2Schema.safeParse({
        headline: 'React leads frontend adoption in 2026',
        context: 'Based on HN discussion trends over the past year.',
        sections: [
          { heading: 'Adoption', body: 'Most used framework.', citedSources: [1] },
          { heading: 'Satisfaction', body: 'High satisfaction scores.', citedSources: [2] },
        ],
        bottomLine: 'React remains the safe enterprise choice.',
        sources: [
          { storyId: 1, title: 'T1', url: '', author: 'a', points: 10, commentCount: 0 },
          { storyId: 2, title: 'T2', url: '', author: 'b', points: 20, commentCount: 5 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject fewer than 2 sections', () => {
      const result = AgentResponseV2Schema.safeParse({
        headline: 'test',
        context: 'test',
        sections: [{ heading: 'Only one', body: 'body', citedSources: [] }],
        bottomLine: 'test',
        sources: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject more than 4 sections', () => {
      const sections = Array.from({ length: 5 }, (_, i) => ({
        heading: `Section ${i}`,
        body: 'body',
        citedSources: [],
      }));
      const result = AgentResponseV2Schema.safeParse({
        headline: 'test',
        context: 'test',
        sections,
        bottomLine: 'test',
        sources: [],
      });
      expect(result.success).toBe(false);
    });
  });
});
```

```typescript
// libs/shared-types/src/lib/pipeline.types.spec.ts
import { PipelineEventSchema, PipelineConfigSchema, PipelineStateSchema } from './pipeline.types';

describe('Pipeline Types', () => {
  describe('PipelineEventSchema', () => {
    it('should parse a valid pipeline event', () => {
      const result = PipelineEventSchema.safeParse({
        stage: 'retriever',
        status: 'started',
        detail: 'Searching HN for "React vs Vue"...',
        elapsed: 0,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid stage', () => {
      const result = PipelineEventSchema.safeParse({
        stage: 'planner',
        status: 'started',
        detail: '',
        elapsed: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PipelineConfigSchema', () => {
    it('should apply defaults for minimal config', () => {
      const result = PipelineConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.useMultiAgent).toBe(false);
        expect(result.data.timeout).toBe(30000);
        expect(result.data.tokenBudgets.retriever).toBe(2000);
      }
    });

    it('should accept full override', () => {
      const result = PipelineConfigSchema.safeParse({
        useMultiAgent: true,
        providerMap: { retriever: 'groq', synthesizer: 'claude', writer: 'mistral' },
        tokenBudgets: { retriever: 3000, synthesizer: 2000, synthesizerInput: 5000, writer: 1500 },
        timeout: 60000,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('PipelineStateSchema', () => {
    it('should parse initial state with only query', () => {
      const result = PipelineStateSchema.safeParse({
        query: 'What is the best JS framework?',
        events: [],
      });
      expect(result.success).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx nx test shared-types --testPathPattern="response-v2|pipeline"`
Expected: FAIL — modules not found.

**Step 3: Write response-v2.types.ts**

```typescript
// libs/shared-types/src/lib/response-v2.types.ts
import { z } from 'zod';

/** A themed section of the agent's prose response. */
export const ResponseSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  citedSources: z.array(z.number()),
});
export type ResponseSection = z.infer<typeof ResponseSectionSchema>;

/** Agent source for v2 response (same shape as legacy AgentSource). */
export const AgentSourceSchema = z.object({
  storyId: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  points: z.number(),
  commentCount: z.number(),
});

/** Structured agent response produced by the Writer. */
export const AgentResponseV2Schema = z.object({
  headline: z.string(),
  context: z.string(),
  sections: z.array(ResponseSectionSchema).min(2).max(4),
  bottomLine: z.string(),
  sources: z.array(AgentSourceSchema),
});
export type AgentResponseV2 = z.infer<typeof AgentResponseV2Schema>;
```

**Step 4: Write pipeline.types.ts**

```typescript
// libs/shared-types/src/lib/pipeline.types.ts
import { z } from 'zod';
import { EvidenceBundleSchema } from './evidence.types';
import { AnalysisResultSchema } from './analysis.types';
import { AgentResponseV2Schema } from './response-v2.types';

export const PipelineStageSchema = z.enum(['retriever', 'synthesizer', 'writer']);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const StageStatusSchema = z.enum(['started', 'progress', 'done', 'error']);
export type StageStatus = z.infer<typeof StageStatusSchema>;

/** SSE event emitted by the pipeline at stage transitions. */
export const PipelineEventSchema = z.object({
  stage: PipelineStageSchema,
  status: StageStatusSchema,
  detail: z.string(),
  elapsed: z.number(),
});
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;

/** Pipeline configuration with per-agent provider mapping and token budgets. */
export const PipelineConfigSchema = z.object({
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
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/** Full pipeline result with intermediates and timing. */
export const PipelineResultSchema = z.object({
  response: AgentResponseV2Schema,
  bundle: EvidenceBundleSchema,
  analysis: AnalysisResultSchema,
  events: z.array(PipelineEventSchema),
  durationMs: z.number(),
});
export type PipelineResult = z.infer<typeof PipelineResultSchema>;

/** Accumulator state threaded through the LangGraph pipeline. */
export const PipelineStateSchema = z.object({
  query: z.string(),
  bundle: EvidenceBundleSchema.optional(),
  analysis: AnalysisResultSchema.optional(),
  response: AgentResponseV2Schema.optional(),
  events: z.array(PipelineEventSchema),
  error: z.string().optional(),
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;
```

**Step 5: Update barrel export**

Add to `libs/shared-types/src/index.ts`:

```typescript
export * from './lib/response-v2.types';
export * from './lib/pipeline.types';
```

**Step 6: Run tests to verify they pass**

Run: `npx nx test shared-types --testPathPattern="response-v2|pipeline"`
Expected: PASS — all 8 tests green.

**Step 7: Commit**

```bash
git add libs/shared-types/src/
git commit -m "feat(shared-types): add response-v2 and pipeline Zod schemas (PipelineConfig, PipelineEvent, PipelineState)"
```

---

## Task 5: Write Agent Prompts

**Files:**

- Create: `apps/api/src/agent/prompts/retriever.prompt.ts`
- Create: `apps/api/src/agent/prompts/compactor.prompt.ts`
- Create: `apps/api/src/agent/prompts/synthesizer.prompt.ts`
- Create: `apps/api/src/agent/prompts/writer.prompt.ts`

**Step 1: Create retriever prompt**

```typescript
// apps/api/src/agent/prompts/retriever.prompt.ts

/**
 * System prompt for the Retriever agent's ReAct loop.
 * The Retriever searches HN, fetches stories and comments,
 * collecting raw evidence for the Compactor.
 */
export const RETRIEVER_SYSTEM_PROMPT = `You are a research assistant gathering evidence from Hacker News to answer a user's question.

## YOUR TASK
Search HN thoroughly to collect relevant stories, comments, and data points.
Use the available tools to search, fetch stories, and read comments.

## STRATEGY
1. Start with 1-2 broad searches related to the query.
2. If initial results are sparse, try alternative search terms.
3. For promising stories (high points, many comments), fetch their comments.
4. Stop when you have sufficient evidence OR after {{maxIterations}} tool calls.

## TOOLS AVAILABLE
- search_hn: Search HN stories by keyword
- get_story: Fetch a specific story by ID
- get_comments: Fetch comments for a story

## IMPORTANT
- Prioritize stories with high points and active discussion.
- Collect diverse viewpoints — don't just grab the first results.
- When you have enough evidence, stop and respond with "DONE".
- Current date: {{currentDate}}
`;
```

**Step 2: Create compactor prompt**

```typescript
// apps/api/src/agent/prompts/compactor.prompt.ts

/**
 * System prompt for the Compactor — converts raw HN data into
 * a structured EvidenceBundle (JSON).
 */
export const COMPACTOR_SYSTEM_PROMPT = `You are a data compactor. You receive raw Hacker News data (stories, comments, search results) and must compress it into a structured JSON evidence bundle.

## OUTPUT FORMAT
Respond with ONLY valid JSON matching this schema:
{
  "query": "the original user query",
  "themes": [
    {
      "label": "Theme name (e.g., 'Performance', 'Developer Experience')",
      "items": [
        {
          "sourceId": 12345,
          "text": "Concise summary of this evidence point (1-2 sentences)",
          "type": "evidence|anecdote|opinion|consensus",
          "relevance": 0.0-1.0
        }
      ]
    }
  ],
  "allSources": [
    {
      "storyId": 12345,
      "title": "Story title",
      "url": "https://...",
      "author": "username",
      "points": 100,
      "commentCount": 50
    }
  ],
  "totalSourcesScanned": 15,
  "tokenCount": 600
}

## RULES
- Group evidence into 3-6 themes. Each theme needs at least one item.
- Classify each item: "evidence" (data/facts), "anecdote" (personal experience), "opinion" (subjective view), "consensus" (widely agreed).
- Score relevance 0.0-1.0 based on how directly the item addresses the query.
- Keep total output under 600 tokens. Be concise in "text" fields.
- Include ALL unique sources in "allSources" even if not all appear in themes.
- Set "tokenCount" to your estimated token count of the themes array.
- Respond with ONLY the JSON object. No markdown fences. No explanation.
`;
```

**Step 3: Create synthesizer prompt**

```typescript
// apps/api/src/agent/prompts/synthesizer.prompt.ts

/**
 * System prompt for the Synthesizer agent.
 * Single-pass: EvidenceBundle → AnalysisResult.
 */
export const SYNTHESIZER_SYSTEM_PROMPT = `You are an analytical synthesizer. You receive a structured evidence bundle from Hacker News and must produce a structured analysis.

## INPUT
You will receive an EvidenceBundle JSON with themes, evidence items, and source metadata.

## OUTPUT FORMAT
Respond with ONLY valid JSON matching this schema:
{
  "summary": "One-paragraph executive summary of what the evidence shows",
  "insights": [
    {
      "claim": "Clear statement of the insight",
      "reasoning": "How the evidence supports this claim",
      "evidenceStrength": "strong|moderate|weak",
      "themeIndices": [0, 2]
    }
  ],
  "contradictions": [
    {
      "claim": "What one side says",
      "counterClaim": "What the other side says",
      "sourceIds": [123, 456]
    }
  ],
  "confidence": "high|medium|low",
  "gaps": ["Areas where evidence is missing or insufficient"]
}

## RULES
- Extract 3-5 insights, ranked by evidence strength. Never exceed 5.
- "themeIndices" reference the index in the input bundle's themes array.
- Flag contradictions where sources genuinely disagree.
- Set confidence based on evidence quality and coverage:
  - "high": Multiple strong evidence items, diverse sources, good coverage
  - "medium": Some strong evidence but gaps exist
  - "low": Mostly opinions/anecdotes, sparse sources, or narrow coverage
- List gaps honestly — what can't be answered from this evidence?
- If the bundle has sparse themes or few items, set confidence to "low" and add "Limited HN discussion found on this topic." to gaps.
- Respond with ONLY the JSON object. No markdown fences. No explanation.
`;
```

**Step 4: Create writer prompt**

```typescript
// apps/api/src/agent/prompts/writer.prompt.ts

/**
 * System prompt for the Writer agent.
 * Single-pass: AnalysisResult + EvidenceBundle → AgentResponseV2.
 */
export const WRITER_SYSTEM_PROMPT = `You are an editorial writer composing a clear, sourced response based on a structured analysis.

## INPUTS
You receive two inputs:
1. AnalysisResult — this is your SOLE source of truth for claims and insights.
2. EvidenceBundle — this is ONLY for looking up source IDs to create citations.

## CITATION RULES
You MUST NOT:
- Re-interpret evidence items in the bundle.
- Draw conclusions that contradict or extend the AnalysisResult.
- Add insights not present in AnalysisResult.insights.
- Change the confidence level or gaps.

If AnalysisResult says confidence is "low", your prose reflects that uncertainty.
If AnalysisResult lists a gap, your response includes that gap as a disclaimer.
You are a composer, not an analyst.

## OUTPUT FORMAT
Respond with ONLY valid JSON matching this schema:
{
  "headline": "Lead with the answer, not the sources (one sentence)",
  "context": "Why this matters — brief paragraph giving context",
  "sections": [
    {
      "heading": "Section theme",
      "body": "Prose paragraph with inline [sourceId] citations",
      "citedSources": [12345, 67890]
    }
  ],
  "bottomLine": "One-sentence takeaway for the reader",
  "sources": [copy allSources from the EvidenceBundle]
}

## RULES
- Write 2-4 sections. Each section covers one insight or theme.
- Use inline citations as [storyId] — only IDs that exist in the bundle's allSources.
- "citedSources" array must contain every storyId referenced in that section's body.
- Copy "sources" directly from the EvidenceBundle's allSources array.
- If confidence is "low", the headline and bottomLine must reflect uncertainty.
- If gaps exist, mention them in the final section or bottomLine.
- Write clear, journalistic prose. No bullet points in section bodies.
- Respond with ONLY the JSON object. No markdown fences. No explanation.
`;
```

**Step 5: Commit**

```bash
git add apps/api/src/agent/prompts/
git commit -m "feat(agent): add pipeline agent prompts (retriever, compactor, synthesizer, writer)"
```

---

## Task 6: Implement Retriever Node (sub-graph)

**Files:**

- Create: `apps/api/src/agent/nodes/retriever.node.ts`
- Test: `apps/api/src/agent/nodes/retriever.node.spec.ts`

**Step 1: Write the failing test**

````typescript
// apps/api/src/agent/nodes/retriever.node.spec.ts
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
  const mockModel = { invoke: jest.fn() } as any;
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

    // Mock ReAct agent returning raw HN data
    mockReactAgentInvoke.mockResolvedValue({
      messages: [{ content: 'Found some results about test query', role: 'assistant' }],
    });

    // Mock compactor LLM call returning structured bundle
    mockModel.invoke.mockResolvedValue({ content: bundleJson });

    const node = createRetrieverNode(mockModel, mockTools);
    const result = await node({ query: 'test query', events: [] });

    expect(result.bundle).toBeDefined();
    const parsed = EvidenceBundleSchema.safeParse(result.bundle);
    expect(parsed.success).toBe(true);
  });

  it('should retry compaction on invalid JSON', async () => {
    mockReactAgentInvoke.mockResolvedValue({
      messages: [{ content: 'data collected', role: 'assistant' }],
    });

    // First call returns invalid JSON, second returns valid
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
    const result = await node({ query: 'test', events: [] });

    expect(result.bundle).toBeDefined();
    expect(mockModel.invoke).toHaveBeenCalledTimes(2);
  });
});
````

**Step 2: Run test to verify it fails**

Run: `npx nx test api --testPathPattern=retriever.node`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

````typescript
// apps/api/src/agent/nodes/retriever.node.ts
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { EvidenceBundleSchema, type EvidenceBundle } from '@voxpopuli/shared-types';
import { RETRIEVER_SYSTEM_PROMPT } from '../prompts/retriever.prompt';
import { COMPACTOR_SYSTEM_PROMPT } from '../prompts/compactor.prompt';

const MAX_REACT_ITERATIONS = 8;

/** Strip markdown code fences from LLM output. */
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
}

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

  return async (state: {
    query: string;
    events: unknown[];
  }): Promise<{ bundle: EvidenceBundle; events: unknown[] }> => {
    const startTime = Date.now();
    const events = [...state.events];

    // Phase 1: ReAct collection
    events.push({
      stage: 'retriever',
      status: 'started',
      detail: `Searching HN for "${state.query}"...`,
      elapsed: 0,
    });

    const reactResult = await reactAgent.invoke({
      messages: [new HumanMessage(state.query)],
    });

    const rawData = reactResult.messages
      .map((m: { content: unknown }) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n\n');

    // Phase 2: Compaction
    events.push({
      stage: 'retriever',
      status: 'progress',
      detail: 'Compacting sources into themes...',
      elapsed: Date.now() - startTime,
    });

    const bundle = await compactWithRetry(model, state.query, rawData);

    events.push({
      stage: 'retriever',
      status: 'done',
      detail: `${bundle.themes.length} themes from ${bundle.allSources.length} sources (~${bundle.tokenCount} tokens)`,
      elapsed: Date.now() - startTime,
    });

    return { bundle, events };
  };
}

/**
 * Compact raw HN data into an EvidenceBundle with one retry on parse failure.
 */
async function compactWithRetry(
  model: BaseChatModel,
  query: string,
  rawData: string,
): Promise<EvidenceBundle> {
  const messages = [
    new SystemMessage(COMPACTOR_SYSTEM_PROMPT),
    new HumanMessage(`Query: ${query}\n\nRaw HN data:\n${rawData.slice(0, 50_000)}`),
  ];

  const firstAttempt = await model.invoke(messages);
  const firstContent = typeof firstAttempt.content === 'string' ? firstAttempt.content : '';

  try {
    const parsed = JSON.parse(stripFences(firstContent));
    const result = EvidenceBundleSchema.safeParse(parsed);
    if (result.success) return result.data;

    // Retry with error details
    messages.push(
      { role: 'assistant', content: firstContent } as any,
      new HumanMessage(
        `Your previous response had validation errors:\n${JSON.stringify(
          result.error.issues,
          null,
          2,
        )}\n\nRespond with valid JSON only, no markdown fencing.`,
      ),
    );
  } catch {
    // JSON parse failed — retry
    messages.push(
      { role: 'assistant', content: firstContent } as any,
      new HumanMessage(
        'Your previous response was not valid JSON. Respond with valid JSON only, no markdown fencing.',
      ),
    );
  }

  const retryAttempt = await model.invoke(messages);
  const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
  const parsed = JSON.parse(stripFences(retryContent));
  const result = EvidenceBundleSchema.parse(parsed);
  return result;
}
````

**Step 4: Run test to verify it passes**

Run: `npx nx test api --testPathPattern=retriever.node`
Expected: PASS — all 3 tests green.

**Step 5: Commit**

```bash
git add apps/api/src/agent/nodes/retriever.node.ts apps/api/src/agent/nodes/retriever.node.spec.ts
git commit -m "feat(agent): implement RetrieverNode with ReAct + compaction and Zod validation"
```

---

## Task 7: Implement Synthesizer Node

**Files:**

- Create: `apps/api/src/agent/nodes/synthesizer.node.ts`
- Test: `apps/api/src/agent/nodes/synthesizer.node.spec.ts`

**Step 1: Write the failing test**

````typescript
// apps/api/src/agent/nodes/synthesizer.node.spec.ts
import { AnalysisResultSchema, type EvidenceBundle } from '@voxpopuli/shared-types';

// Mock LLM providers
jest.mock('../../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

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
});
````

**Step 2: Run test to verify it fails**

Run: `npx nx test api --testPathPattern=synthesizer.node`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

````typescript
// apps/api/src/agent/nodes/synthesizer.node.ts
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AnalysisResultSchema,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';
import { SYNTHESIZER_SYSTEM_PROMPT } from '../prompts/synthesizer.prompt';

/** Strip markdown code fences from LLM output. */
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
}

/**
 * Creates the Synthesizer node function for the pipeline.
 * Single-pass: EvidenceBundle → AnalysisResult with one retry on parse failure.
 */
export function createSynthesizerNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
    events: unknown[];
  }): Promise<{ analysis: AnalysisResult; events: unknown[] }> => {
    const startTime = Date.now();
    const events = [...state.events];

    events.push({
      stage: 'synthesizer',
      status: 'started',
      detail: `Analyzing ${state.bundle.themes.length} themes...`,
      elapsed: Date.now() - startTime,
    });

    const messages = [
      new SystemMessage(SYNTHESIZER_SYSTEM_PROMPT),
      new HumanMessage(JSON.stringify(state.bundle)),
    ];

    const analysis = await invokeWithRetry(model, messages, AnalysisResultSchema);

    events.push({
      stage: 'synthesizer',
      status: 'done',
      detail: `${analysis.insights.length} insights, ${analysis.contradictions.length} contradictions, confidence: ${analysis.confidence}`,
      elapsed: Date.now() - startTime,
    });

    return { analysis, events };
  };
}

/**
 * Invoke an LLM and parse output through a Zod schema with one retry.
 */
async function invokeWithRetry<T>(
  model: BaseChatModel,
  messages: Array<SystemMessage | HumanMessage | any>,
  schema: {
    safeParse: (data: unknown) => { success: boolean; data?: T; error?: { issues: unknown[] } };
    parse: (data: unknown) => T;
  },
): Promise<T> {
  const firstAttempt = await model.invoke(messages);
  const firstContent = typeof firstAttempt.content === 'string' ? firstAttempt.content : '';

  try {
    const parsed = JSON.parse(stripFences(firstContent));
    const result = schema.safeParse(parsed);
    if (result.success) return result.data!;

    messages.push(
      { role: 'assistant', content: firstContent },
      new HumanMessage(
        `Validation errors:\n${JSON.stringify(
          result.error!.issues,
          null,
          2,
        )}\n\nRespond with valid JSON only.`,
      ),
    );
  } catch {
    messages.push(
      { role: 'assistant', content: firstContent },
      new HumanMessage(
        'Your response was not valid JSON. Respond with valid JSON only, no markdown fencing.',
      ),
    );
  }

  const retryAttempt = await model.invoke(messages);
  const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
  return schema.parse(JSON.parse(stripFences(retryContent)));
}
````

**Step 4: Run test to verify it passes**

Run: `npx nx test api --testPathPattern=synthesizer.node`
Expected: PASS — all 4 tests green.

**Step 5: Commit**

```bash
git add apps/api/src/agent/nodes/synthesizer.node.ts apps/api/src/agent/nodes/synthesizer.node.spec.ts
git commit -m "feat(agent): implement SynthesizerNode with Zod validation and retry"
```

---

## Task 8: Implement Writer Node (with token streaming)

**Files:**

- Create: `apps/api/src/agent/nodes/writer.node.ts`
- Test: `apps/api/src/agent/nodes/writer.node.spec.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/src/agent/nodes/writer.node.spec.ts
import {
  AgentResponseV2Schema,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';

jest.mock('../../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

import { createWriterNode } from './writer.node';

const SAMPLE_BUNDLE: EvidenceBundle = {
  query: 'React vs Vue',
  themes: [
    { label: 'Perf', items: [{ sourceId: 1, text: 'Fast', type: 'evidence', relevance: 0.9 }] },
  ],
  allSources: [{ storyId: 1, title: 'Story', url: '', author: 'a', points: 10, commentCount: 0 }],
  totalSourcesScanned: 5,
  tokenCount: 200,
};

const SAMPLE_ANALYSIS: AnalysisResult = {
  summary: 'React leads in adoption',
  insights: [
    {
      claim: 'React is popular',
      reasoning: 'Most cited',
      evidenceStrength: 'strong',
      themeIndices: [0],
    },
  ],
  contradictions: [],
  confidence: 'medium',
  gaps: ['No Vue 4 data'],
};

describe('WriterNode', () => {
  const mockModel = { invoke: jest.fn() } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should produce a valid AgentResponseV2', async () => {
    const responseJson = JSON.stringify({
      headline: 'React remains the top framework choice in 2026',
      context: 'Based on HN discussion trends.',
      sections: [
        { heading: 'Adoption', body: 'React leads [1].', citedSources: [1] },
        { heading: 'Community', body: 'Active community [1].', citedSources: [1] },
      ],
      bottomLine: 'React is the safe bet for enterprise.',
      sources: SAMPLE_BUNDLE.allSources,
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'React vs Vue',
      bundle: SAMPLE_BUNDLE,
      analysis: SAMPLE_ANALYSIS,
      events: [],
    });

    expect(result.response).toBeDefined();
    const parsed = AgentResponseV2Schema.safeParse(result.response);
    expect(parsed.success).toBe(true);
  });

  it('should reflect low confidence from analysis', async () => {
    const lowConfAnalysis = {
      ...SAMPLE_ANALYSIS,
      confidence: 'low' as const,
      gaps: ['Very limited data'],
    };
    const responseJson = JSON.stringify({
      headline: 'Limited data makes definitive conclusions difficult',
      context: 'Few HN discussions found.',
      sections: [
        { heading: 'What we found', body: 'Limited evidence [1].', citedSources: [1] },
        { heading: 'Gaps', body: 'Very limited data available.', citedSources: [] },
      ],
      bottomLine: 'Insufficient evidence for a strong recommendation.',
      sources: SAMPLE_BUNDLE.allSources,
    });
    mockModel.invoke.mockResolvedValue({ content: responseJson });

    const node = createWriterNode(mockModel);
    const result = await node({
      query: 'test',
      bundle: SAMPLE_BUNDLE,
      analysis: lowConfAnalysis,
      events: [],
    });

    expect(result.response).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx nx test api --testPathPattern=writer.node`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

````typescript
// apps/api/src/agent/nodes/writer.node.ts
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AgentResponseV2Schema,
  type AgentResponseV2,
  type AnalysisResult,
  type EvidenceBundle,
} from '@voxpopuli/shared-types';
import { WRITER_SYSTEM_PROMPT } from '../prompts/writer.prompt';

/** Strip markdown code fences from LLM output. */
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
}

/**
 * Creates the Writer node function for the pipeline.
 * Single-pass: AnalysisResult + EvidenceBundle → AgentResponseV2.
 */
export function createWriterNode(model: BaseChatModel) {
  return async (state: {
    query: string;
    bundle: EvidenceBundle;
    analysis: AnalysisResult;
    events: unknown[];
  }): Promise<{ response: AgentResponseV2; events: unknown[] }> => {
    const startTime = Date.now();
    const events = [...state.events];

    events.push({
      stage: 'writer',
      status: 'started',
      detail: 'Composing headline and sections...',
      elapsed: Date.now() - startTime,
    });

    const input = JSON.stringify({
      analysis: state.analysis,
      bundle: state.bundle,
    });

    const messages = [new SystemMessage(WRITER_SYSTEM_PROMPT), new HumanMessage(input)];

    const response = await invokeWithRetry(model, messages);

    events.push({
      stage: 'writer',
      status: 'done',
      detail: `${response.sections.length} sections, ${response.sources.length} sources cited`,
      elapsed: Date.now() - startTime,
    });

    return { response, events };
  };
}

/**
 * Invoke LLM and parse as AgentResponseV2 with one retry.
 */
async function invokeWithRetry(
  model: BaseChatModel,
  messages: Array<SystemMessage | HumanMessage | any>,
): Promise<AgentResponseV2> {
  const firstAttempt = await model.invoke(messages);
  const firstContent = typeof firstAttempt.content === 'string' ? firstAttempt.content : '';

  try {
    const parsed = JSON.parse(stripFences(firstContent));
    const result = AgentResponseV2Schema.safeParse(parsed);
    if (result.success) return result.data;

    messages.push(
      { role: 'assistant', content: firstContent },
      new HumanMessage(
        `Validation errors:\n${JSON.stringify(
          result.error.issues,
          null,
          2,
        )}\n\nRespond with valid JSON only.`,
      ),
    );
  } catch {
    messages.push(
      { role: 'assistant', content: firstContent },
      new HumanMessage(
        'Your response was not valid JSON. Respond with valid JSON only, no markdown fencing.',
      ),
    );
  }

  const retryAttempt = await model.invoke(messages);
  const retryContent = typeof retryAttempt.content === 'string' ? retryAttempt.content : '';
  return AgentResponseV2Schema.parse(JSON.parse(stripFences(retryContent)));
}
````

**Step 4: Run test to verify it passes**

Run: `npx nx test api --testPathPattern=writer.node`
Expected: PASS — all 2 tests green.

**Step 5: Commit**

```bash
git add apps/api/src/agent/nodes/writer.node.ts apps/api/src/agent/nodes/writer.node.spec.ts
git commit -m "feat(agent): implement WriterNode with citation rules and Zod validation"
```

---

## Task 9: Implement OrchestratorService (LangGraph StateGraph)

**Files:**

- Create: `apps/api/src/agent/orchestrator.service.ts`
- Modify: `apps/api/src/agent/agent.module.ts`
- Test: `apps/api/src/agent/orchestrator.service.spec.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/src/agent/orchestrator.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { OrchestratorService } from './orchestrator.service';
import { AgentService } from './agent.service';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import type { PipelineConfig } from '@voxpopuli/shared-types';

// Mock everything
jest.mock('langchain', () => ({ createAgent: jest.fn() }));
jest.mock('./tools', () => ({ createAgentTools: jest.fn(() => []) }));
jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

// Mock LangGraph
const mockGraphStreamEvents = jest.fn();
jest.mock('@langchain/langgraph', () => ({
  StateGraph: jest.fn().mockImplementation(() => ({
    addNode: jest.fn().mockReturnThis(),
    addEdge: jest.fn().mockReturnThis(),
    compile: jest.fn().mockReturnValue({
      streamEvents: mockGraphStreamEvents,
    }),
  })),
  Annotation: {
    Root: jest.fn((schema: any) => schema),
  },
  START: '__start__',
  END: '__end__',
}));

jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(() => ({ invoke: jest.fn() })),
}));

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let agentService: AgentService;

  const mockLlm = {
    getModel: jest.fn(() => ({ invoke: jest.fn(), stream: jest.fn() })),
    getProviderName: jest.fn(() => 'groq'),
  };
  const mockHn = {};
  const mockChunker = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestratorService,
        { provide: AgentService, useValue: { runStream: jest.fn() } },
        { provide: LlmService, useValue: mockLlm },
        { provide: HnService, useValue: mockHn },
        { provide: ChunkerService, useValue: mockChunker },
      ],
    }).compile();

    service = module.get(OrchestratorService);
    agentService = module.get(AgentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should fall back to legacy agent on pipeline error', async () => {
    mockGraphStreamEvents.mockImplementation(async function* () {
      throw new Error('Pipeline kaboom');
    });

    const mockLegacyEvents = (async function* () {
      yield {
        kind: 'complete' as const,
        response: { answer: 'legacy answer', steps: [], sources: [], meta: {}, trust: {} },
      };
    })();
    (agentService.runStream as jest.Mock).mockReturnValue(mockLegacyEvents);

    const config: PipelineConfig = {
      useMultiAgent: true,
      providerMap: {},
      tokenBudgets: { retriever: 2000, synthesizer: 1500, synthesizerInput: 4000, writer: 1000 },
      timeout: 30000,
    };

    const events = [];
    for await (const event of service.runWithFallback('test query', config)) {
      events.push(event);
    }

    expect(agentService.runStream).toHaveBeenCalledWith('test query', undefined);
    expect(events.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx nx test api --testPathPattern=orchestrator.service`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```typescript
// apps/api/src/agent/orchestrator.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type { PipelineConfig, PipelineEvent, AgentResponseV2 } from '@voxpopuli/shared-types';
import type { AgentStep, AgentResponse } from '@voxpopuli/shared-types';
import { AgentService, type AgentStreamEvent } from './agent.service';
import { LlmService } from '../llm/llm.service';
import { HnService } from '../hn/hn.service';
import { ChunkerService } from '../chunker/chunker.service';
import { createAgentTools } from './tools';
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
 * Orchestrates the multi-agent pipeline using LangGraph.
 *
 * Pipeline: Retriever → Synthesizer → Writer
 * Fallback: Legacy AgentService on any pipeline failure.
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
        event: { stage: 'retriever', status: 'error', detail: message, elapsed: 0 },
      } as PipelineStreamEvent;

      // Delegate to existing AgentService
      for await (const event of this.agentService.runStream(query)) {
        yield event;
      }
    }
  }

  /**
   * Run the full LangGraph pipeline, streaming events.
   */
  async *runStream(query: string, config: PipelineConfig): AsyncGenerator<PipelineStreamEvent> {
    const startTime = Date.now();

    // Resolve model per stage (fallback to global provider)
    const getModel = (stage: 'retriever' | 'synthesizer' | 'writer') =>
      this.llm.getModel(config.providerMap[stage]);

    const tools = createAgentTools(this.hn, this.chunker);

    // Build node functions
    const retrieverNode = createRetrieverNode(getModel('retriever'), tools);
    const synthesizerNode = createSynthesizerNode(getModel('synthesizer'));
    const writerNode = createWriterNode(getModel('writer'));

    // Build LangGraph StateGraph
    const PipelineStateAnnotation = Annotation.Root({
      query: Annotation<string>,
      bundle: Annotation<any>,
      analysis: Annotation<any>,
      response: Annotation<any>,
      events: Annotation<any[]>({
        reducer: (existing, update) => update, // nodes return full events array
      }),
      error: Annotation<string | undefined>,
    });

    const graph = new StateGraph(PipelineStateAnnotation)
      .addNode('retriever', retrieverNode)
      .addNode('synthesizer', synthesizerNode)
      .addNode('writer', writerNode)
      .addEdge(START, 'retriever')
      .addEdge('retriever', 'synthesizer')
      .addEdge('synthesizer', 'writer')
      .addEdge('writer', END)
      .compile();

    const initialState = {
      query,
      events: [],
      bundle: undefined,
      analysis: undefined,
      response: undefined,
      error: undefined,
    };

    // Stream events from the graph
    const eventStream = graph.streamEvents(initialState, { version: 'v2' });

    let lastPipelineEventCount = 0;

    for await (const event of eventStream) {
      // Retriever inner steps — tool calls and observations
      if (event.event === 'on_tool_start') {
        yield {
          kind: 'step',
          step: {
            type: 'action',
            content: `Calling ${event.name}`,
            toolName: event.name,
            toolInput: event.data?.input,
            timestamp: Date.now(),
          },
        };
      }

      if (event.event === 'on_tool_end') {
        yield {
          kind: 'step',
          step: {
            type: 'observation',
            content:
              typeof event.data?.output === 'string'
                ? event.data.output
                : JSON.stringify(event.data?.output),
            toolName: event.name,
            toolOutput:
              typeof event.data?.output === 'string'
                ? event.data.output
                : JSON.stringify(event.data?.output),
            timestamp: Date.now(),
          },
        };
      }

      // Writer token streaming
      if (event.event === 'on_chat_model_stream' && event.metadata?.langgraph_node === 'writer') {
        const chunk = event.data?.chunk;
        if (chunk?.content && typeof chunk.content === 'string') {
          yield { kind: 'token', content: chunk.content };
        }
      }

      // Pipeline events from state updates
      if (event.event === 'on_chain_end' && event.data?.output?.events) {
        const allEvents = event.data.output.events as PipelineEvent[];
        // Emit only new pipeline events
        for (let i = lastPipelineEventCount; i < allEvents.length; i++) {
          yield { kind: 'pipeline', event: allEvents[i] };
        }
        lastPipelineEventCount = allEvents.length;

        // If writer is done, emit complete event
        if (event.data.output.response) {
          const v2Response = event.data.output.response as AgentResponseV2;
          yield {
            kind: 'complete',
            response: {
              answer: `## ${v2Response.headline}\n\n${v2Response.context}\n\n${v2Response.sections
                .map((s) => `### ${s.heading}\n\n${s.body}`)
                .join('\n\n')}\n\n**Bottom line:** ${v2Response.bottomLine}`,
              steps: [],
              sources: v2Response.sources.map((s) => ({ ...s, url: s.url ?? '' })),
              meta: {
                provider: this.llm.getProviderName(),
                totalInputTokens: 0,
                totalOutputTokens: 0,
                durationMs: Date.now() - startTime,
                cached: false,
              },
              trust: {
                sourcesVerified: v2Response.sources.length,
                sourcesTotal: v2Response.sources.length,
                avgSourceAge: 0,
                recentSourceRatio: 0,
                viewpointDiversity: 'balanced',
                showHnCount: 0,
                honestyFlags: [],
              },
            },
          };
        }
      }
    }
  }
}
```

**Step 4: Update AgentModule**

Modify `apps/api/src/agent/agent.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { OrchestratorService } from './orchestrator.service';
import { HnModule } from '../hn/hn.module';
import { ChunkerModule } from '../chunker/chunker.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [HnModule, ChunkerModule, LlmModule],
  providers: [AgentService, OrchestratorService],
  exports: [AgentService, OrchestratorService],
})
export class AgentModule {}
```

**Step 5: Run test to verify it passes**

Run: `npx nx test api --testPathPattern=orchestrator.service`
Expected: PASS — all 2 tests green.

**Step 6: Commit**

```bash
git add apps/api/src/agent/orchestrator.service.ts apps/api/src/agent/orchestrator.service.spec.ts apps/api/src/agent/agent.module.ts
git commit -m "feat(agent): implement OrchestratorService with LangGraph StateGraph and legacy fallback"
```

---

## Task 10: Wire Pipeline to RagController

**Files:**

- Modify: `apps/api/src/rag/rag.controller.ts`
- Modify: `apps/api/src/rag/dto/rag-query.dto.ts`

**Step 1: Check existing DTO**

Read `apps/api/src/rag/dto/rag-query.dto.ts` to understand the current shape.

**Step 2: Add `useMultiAgent` to the DTO**

Add an optional `useMultiAgent` boolean field to `RagQueryDto`.

**Step 3: Update RagController to use OrchestratorService**

Modify the `stream()` method in `rag.controller.ts`:

- Inject `OrchestratorService` alongside `AgentService`
- Add `useMultiAgent` query param to the SSE endpoint
- When `useMultiAgent` is truthy, delegate to `OrchestratorService.runWithFallback()`
- Map `PipelineStreamEvent` types to SSE `MessageEvent`:
  - `kind: 'pipeline'` → SSE type `pipeline`
  - `kind: 'step'` → SSE type matching `step.type` (thought/action/observation)
  - `kind: 'token'` → SSE type `token`
  - `kind: 'complete'` → SSE type `answer`
- Legacy path unchanged when `useMultiAgent` is absent or false

**Step 4: Run existing RagController tests**

Run: `npx nx test api --testPathPattern=rag.controller`
Expected: PASS — existing tests still green (they don't use multi-agent).

**Step 5: Commit**

```bash
git add apps/api/src/rag/
git commit -m "feat(rag): wire OrchestratorService to RagController with useMultiAgent flag"
```

---

## Task 11: Update Frontend RagService for Pipeline SSE

**Files:**

- Modify: `apps/web/src/app/services/rag.service.ts`

**Step 1: Extend StreamEvent union**

Add new event types to the `StreamEvent` discriminated union:

```typescript
| { type: 'pipeline'; stage: string; status: string; detail: string; elapsed: number }
| { type: 'token'; content: string }
```

**Step 2: Update EventSource listeners**

Add `'pipeline'` and `'token'` to the `EVENT_TYPES` array in the `stream()` method. Add corresponding cases to `parseStreamEvent()`.

**Step 3: Add `useMultiAgent` query param support**

Update `stream()` to accept an optional `useMultiAgent` parameter and append it to the SSE URL.

**Step 4: Verify build**

Run: `npx nx build web`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add apps/web/src/app/services/rag.service.ts
git commit -m "feat(web): extend RagService SSE parsing for pipeline events and token streaming"
```

---

## Task 12: Update AgentStepsComponent for Pipeline Mode

**Files:**

- Modify: `apps/web/src/app/components/agent-steps/agent-steps.component.ts`
- Modify: `apps/web/src/app/components/agent-steps/agent-steps.component.html`

**Step 1: Add pipeline mode inputs**

Add new inputs to the component:

```typescript
readonly pipelineEvents = input<PipelineEvent[]>([]);
readonly isPipelineMode = input<boolean>(false);
```

**Step 2: Add pipeline stage computed signal**

Create a computed signal that groups pipeline events by stage for the three-stage timeline display.

**Step 3: Update template**

Add a conditional template block: when `isPipelineMode()` is true, render a three-stage timeline (retriever → synthesizer → writer) with progress details. When false, render the existing ReAct step view unchanged.

**Step 4: Verify build**

Run: `npx nx build web`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add apps/web/src/app/components/agent-steps/
git commit -m "feat(web): add pipeline mode to AgentStepsComponent with three-stage timeline"
```

---

## Task 13: Wire Pipeline Mode in ChatComponent

**Files:**

- Modify: `apps/web/src/app/components/chat/chat.component.ts`

**Step 1: Add pipeline state signals**

Add signals for tracking pipeline events, token stream content, and pipeline mode detection.

**Step 2: Update stream subscription**

In the stream subscription handler, detect pipeline mode from event types and route events to the appropriate signals.

**Step 3: Pass pipeline signals to AgentStepsComponent**

Wire the new inputs in the chat template.

**Step 4: Verify build**

Run: `npx nx build web`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add apps/web/src/app/components/chat/
git commit -m "feat(web): wire pipeline mode detection and signals in ChatComponent"
```

---

## Task 14: Add `.env.example` Entry and Feature Flag Documentation

**Files:**

- Modify: `.env.example`
- Modify: `CLAUDE.md`

**Step 1: Add to .env.example**

Add `USE_MULTI_AGENT=false` with a comment explaining the feature flag.

**Step 2: Update CLAUDE.md**

Add the OrchestratorService, nodes/, and prompts/ to the repository structure section. Add a note about the `useMultiAgent` feature flag under Key Constraints.

**Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: add multi-agent feature flag to .env.example and update CLAUDE.md"
```

---

## Task 15: Run Full Test Suite and Fix Issues

**Step 1: Run all tests**

Run: `npx nx test`
Expected: All existing + new tests pass.

**Step 2: Run linting**

Run: `npx nx affected:lint`
Expected: No lint errors.

**Step 3: Run build**

Run: `npx nx build api && npx nx build web`
Expected: Both builds succeed.

**Step 4: Fix any failures**

Address any compilation errors, test failures, or lint issues discovered.

**Step 5: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve test/lint/build issues from M8 pipeline integration"
```

---

## Task 16: Update Linear Issues

Update the following Linear issues to reflect implementation progress:

- AI-280 (Pipeline Types) → In Progress / Done
- AI-284 (Define pipeline types) → Done
- AI-285 (Agent Implementation) → In Progress
- AI-286 (RetrieverAgent) → Done
- AI-287 (SynthesizerAgent) → Done
- AI-288 (WriterAgent) → Done
- AI-289 (OrchestratorService) → Done
- AI-298 (Frontend Integration) → In Progress
- AI-299 (AgentStepsComponent) → Done
- AI-300 (RagService SSE) → Done
- AI-302 (Feature flag) → Done

---

## Summary

| Task | What                                                      | Linear Issue   |
| ---- | --------------------------------------------------------- | -------------- |
| 1    | Install @langchain/langgraph                              | —              |
| 2    | Evidence Zod schemas                                      | AI-280, AI-284 |
| 3    | Analysis Zod schemas                                      | AI-280, AI-284 |
| 4    | Response v2 + Pipeline Zod schemas                        | AI-280, AI-284 |
| 5    | Agent prompts (retriever, compactor, synthesizer, writer) | AI-285         |
| 6    | RetrieverNode (sub-graph)                                 | AI-286         |
| 7    | SynthesizerNode                                           | AI-287         |
| 8    | WriterNode                                                | AI-288         |
| 9    | OrchestratorService (LangGraph StateGraph)                | AI-289         |
| 10   | Wire to RagController                                     | AI-302         |
| 11   | Frontend RagService SSE                                   | AI-300         |
| 12   | AgentStepsComponent pipeline mode                         | AI-299         |
| 13   | ChatComponent wiring                                      | AI-299         |
| 14   | Docs and feature flag                                     | AI-304         |
| 15   | Full test suite verification                              | AI-293         |
| 16   | Linear issue updates                                      | AI-301         |
