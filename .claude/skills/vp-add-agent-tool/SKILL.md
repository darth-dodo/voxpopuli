---
name: vp-add-agent-tool
description: Use when adding a new tool to the VoxPopuli ReAct agent - covers tool() definition with Zod schema, HnService integration, chunker output formatting, and test patterns
---

# Add Agent Tool (VoxPopuli)

## Overview

Pattern for adding a new tool that the ReAct agent can invoke during its reasoning loop. Tools wrap HnService methods using LangChain's `tool()` helper with Zod-validated input schemas.

## When to Use

- Adding new data retrieval capabilities to the agent
- Extending the agent's tool set beyond `search_hn`, `get_story`, `get_comments`
- **Not for:** modifying the agent loop itself, LLM provider changes, frontend work

## Tool Architecture

```
AgentService (createAgent from 'langchain')
  └── StructuredToolInterface[]
        ├── search_hn    → HnService.search() → ChunkerService.chunkStories()
        ├── get_story    → HnService.getItem() → ChunkerService formatting
        └── get_comments → HnService.getCommentTree() → ChunkerService.chunkComments()
```

LangChain handles tool protocol translation per provider (tool_use blocks for Claude, tool role for Mistral/Groq). We define tools once.

## Implementation Pattern

Tools are defined in `apps/api/src/agent/tools.ts` using the `tool()` helper from `langchain`:

```typescript
import { tool } from 'langchain';
import { z } from 'zod';
import type { StructuredToolInterface } from '@langchain/core/tools';

export function createMyNewTool(hn: HnService, chunker: ChunkerService): StructuredToolInterface {
  return tool(
    async (input: { query: string; limit?: number }): Promise<string> => {
      const results = await hn.search(input.query, { hitsPerPage: input.limit });
      const chunks = chunker.chunkStories(results.hits);
      const context = chunker.buildContext(chunks, [], Infinity);
      return chunker.formatForPrompt(context);
    },
    {
      name: 'my_new_tool',
      description: 'What this tool does (LLM reads this to decide when to use it)',
      schema: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().min(1).max(20).optional().describe('Max results'),
      }),
    },
  );
}
```

**Important:** Use `tool()` from `langchain`, NOT `new DynamicTool()` from `@langchain/core/tools`. The `DynamicTool` class expects `func(input: string)` which causes TypeScript errors with Zod schemas. The `tool()` helper correctly types the function input.

## Adding a New Tool

1. Add the factory function to `apps/api/src/agent/tools.ts`
2. Add it to the `createAgentTools()` array at the bottom of the file
3. Update the system prompt in `apps/api/src/agent/system-prompt.ts` to mention the new tool
4. Update `apps/api/src/agent/trust.ts` if the tool produces data relevant to trust scoring (dates, source IDs)
5. Add tests

## Key Rules

| Rule                                   | Why                                                            |
| -------------------------------------- | -------------------------------------------------------------- |
| Zod schema on every tool               | LangChain generates JSON schema from it for tool_call protocol |
| `.describe()` on every Zod field       | LLM needs descriptions to use tools correctly                  |
| Return chunked string, not raw JSON    | Agent reads the output as text in its reasoning                |
| Route through ChunkerService           | Ensures token counting and HTML stripping                      |
| Pass `Infinity` budget to buildContext | Token budgeting happens at the agent level, not per tool       |
| Cache-aware via HnService              | HnService already wraps calls in CacheService                  |
| Respect 30-comment cap                 | `getCommentTree` has a max, don't override                     |

## Testing Tools

```typescript
// Mock HnService and ChunkerService
const mockHnService = { search: jest.fn().mockResolvedValue({ hits: [...] }) };
const mockChunkerService = {
  chunkStories: jest.fn().mockReturnValue([...]),
  buildContext: jest.fn().mockReturnValue({ stories: [], comments: [], totalTokens: 0, truncated: false }),
  formatForPrompt: jest.fn().mockReturnValue('formatted output'),
};

// Test tool invocation via the factory function
const tool = createMyNewTool(mockHnService as any, mockChunkerService as any);
const result = await tool.invoke({ query: 'rust vs go' });
expect(mockHnService.search).toHaveBeenCalledWith('rust vs go', expect.any(Object));
```

**Jest ESM note:** Test files that import from AgentService or tools must mock the LLM providers to avoid ESM resolution failures:

```typescript
jest.mock('../llm/providers/groq.provider', () => ({ GroqProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));
jest.mock('langchain', () => ({ createAgent: jest.fn(), tool: jest.fn() }));
```

## Common Mistakes

- Using `new DynamicTool()` instead of `tool()` (TypeScript type errors with schemas)
- Returning raw API responses instead of chunked/formatted text
- Not adding Zod `.describe()` on parameters (LLM needs descriptions to use tools correctly)
- Calling LLM provider SDKs directly instead of going through LangChain tool protocol
- Forgetting to update the system prompt when adding a new tool
- Hardcoding token budgets instead of passing `Infinity` (budgeting is per-agent, not per-tool)
