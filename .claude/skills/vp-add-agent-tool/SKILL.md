---
name: vp-add-agent-tool
description: Use when adding or changing a tool the VoxPopuli ReAct agent or pipeline Retriever can call (search_hn, get_story, get_comments, or a new one), or when agent runs fail with "Received tool input did not match expected schema" or hit the step limit repeating the same tool call
---

# Add Agent Tool (VoxPopuli)

## Overview

Tools wrap `HnService` methods with LangChain's `tool()` helper and a Zod schema. One tool set serves **both** agent paths, so a tool is only "added" when both prompts describe it and its schema accepts what real models send.

```
createAgentTools() (apps/api/src/agent/tools.ts)
  ├── AgentService           legacy ReAct loop  → prompt: agent/system-prompt.ts
  └── OrchestratorService    pipeline Retriever → prompt: agent/prompts/retriever.prompt.ts
```

## Schema Pattern

Open-weight models served via OpenRouter often send numbers as strings (`"min_points":"10"`). A plain `z.number()` rejects them; the agent retries the same bad call until it hits the 7-step limit and returns a partial answer. Use `z.coerce.number()` for every numeric field. The JSON schema the model sees still says `number`.

```typescript
import { tool } from 'langchain';
import { z } from 'zod';

export function createGetUserTool(hn: HnService, chunker: ChunkerService): StructuredToolInterface {
  return tool(
    async (input: { username: string; max_items?: number }): Promise<string> => {
      const stories = await hn.getUserSubmissions(input.username, input.max_items ?? 10);
      const context = chunker.buildContext(chunker.chunkStories(stories), [], Infinity);
      return chunker.formatForPrompt(context);
    },
    {
      name: 'get_user',
      description:
        'Fetch an HN user profile and recent submissions. Use for questions about a specific user.',
      schema: z.object({
        username: z.string().describe('HN username'),
        max_items: z.coerce
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe('Submissions to return (1-50, default 10)'),
      }),
    },
  );
}
```

Use `tool()` from `langchain`, not `new DynamicTool()` (its `func(input: string)` signature breaks Zod typing).

## Files to Touch

1. `apps/api/src/agent/tools.ts`: factory, plus an entry in `createAgentTools()`
2. `apps/api/src/agent/system-prompt.ts`: tool line for the legacy agent
3. `apps/api/src/agent/prompts/retriever.prompt.ts`: tool line for the pipeline (**the default path**)
4. `apps/api/src/hn/hn.service.ts`: new data method, via `CacheService.getOrSet()`
5. `apps/api/src/agent/trust.ts`: only if the output carries dates or story IDs used for trust scoring
6. `apps/api/src/agent/tools.spec.ts`: tests below

## Testing

`tools.spec.ts` mocks `tool()`, so `tool.invoke()` calls your function **directly and skips the schema**. Test the schema explicitly:

```typescript
it('coerces numeric strings sent by some models', () => {
  const parsed = userTool.schema.parse({ username: 'pg', max_items: '25' });
  expect(parsed.max_items).toBe(25);
});

it('advertises numeric params as numbers', () => {
  const json = toJsonSchema(userTool.schema) as { properties: Record<string, { type?: string }> };
  expect(json.properties['max_items'].type).toBe('number'); // from '@langchain/core/utils/json_schema'
});
```

Spec files that reach `AgentService`/`LlmService` must mock the providers (Jest can't load `@langchain/*` ESM):

```typescript
jest.mock('../llm/providers/openrouter.provider', () => ({ OpenRouterProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));
```

## Quick Reference

| Rule                                     | Why                                                             |
| ---------------------------------------- | --------------------------------------------------------------- |
| `z.coerce.number()` for numbers          | Models send `"10"`; plain `z.number()` burns agent steps        |
| `.describe()` on every field             | The LLM picks arguments from these descriptions                 |
| Return chunked text via `ChunkerService` | The agent reasons over text; chunker strips HTML, counts tokens |
| `buildContext(..., Infinity)`            | Budgeting happens per agent, not per tool                       |
| Data access through `HnService`          | It already caches; respect the 30-comment cap                   |

## Verify With a Real Model

Unit tests can't show how a model calls the tool. Run one query end-to-end on the OpenRouter provider (see vp-e2e-verify) and grep the API log for `did not match expected schema`. There should be zero hits. Failed calls appear as observations starting `Error invoking tool`; `partial-response.ts` filters these out of user-facing answers, so they won't show up in the UI.

## Common Mistakes

- `z.number()` instead of `z.coerce.number()`
- Updating `system-prompt.ts` but not `retriever.prompt.ts`, so the pipeline never uses the tool
- Testing only through `tool.invoke()`, which skips the schema in this repo's mocked setup
- Testing a re-declared copy of the schema; test the factory's own `tool.schema` so the test breaks when the tool changes
- Returning raw API JSON instead of chunked, formatted text
