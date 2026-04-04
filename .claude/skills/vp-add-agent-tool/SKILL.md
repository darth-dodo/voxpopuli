---
name: vp-add-agent-tool
description: Use when adding a new tool to the VoxPopuli ReAct agent - covers DynamicTool definition with Zod schema, HnService integration, chunker output formatting, and test patterns
---

# Add Agent Tool (VoxPopuli)

## Overview

Pattern for adding a new tool that the ReAct agent can invoke during its reasoning loop. Tools wrap HnService methods behind LangChain `DynamicTool` instances with Zod-validated input schemas.

## When to Use

- Implementing M3 agent tools (`search_hn`, `get_story`, `get_comments`)
- Adding new data retrieval capabilities to the agent
- **Not for:** modifying the agent loop itself, LLM provider changes, frontend work

## Tool Architecture

```
AgentService
  └── DynamicTool[]
        ├── search_hn    → HnService.search() → ChunkerService.chunkStories()
        ├── get_story    → HnService.getItem() → ChunkerService.chunkStories()
        └── get_comments → HnService.getCommentTree() → ChunkerService.chunkComments()
```

LangChain handles tool protocol translation per provider (tool_use blocks for Claude, tool role for Mistral/Groq). We define tools once.

## Implementation Pattern

```typescript
import { DynamicTool } from '@langchain/core/tools';
import { z } from 'zod';

const searchHnTool = new DynamicTool({
  name: 'search_hn',
  description: 'Search Hacker News stories by keyword query. Returns story metadata and text.',
  schema: z.object({
    query: z.string().describe('Search query'),
    hitsPerPage: z.number().optional().default(10),
  }),
  func: async (input) => {
    const results = await hnService.search(input.query, { hitsPerPage: input.hitsPerPage });
    const chunks = chunkerService.chunkStories(results.hits);
    return chunkerService.formatForPrompt({
      stories: chunks,
      comments: [],
      totalTokens: 0,
      truncated: false,
    });
  },
});
```

## Key Rules

| Rule                                | Why                                                            |
| ----------------------------------- | -------------------------------------------------------------- |
| Zod schema on every tool            | LangChain generates JSON schema from it for tool_call protocol |
| Return chunked string, not raw JSON | Agent reads the output as text in its reasoning                |
| Route through ChunkerService        | Ensures token counting and HTML stripping                      |
| Cache-aware via HnService           | HnService already wraps calls in CacheService                  |
| Respect 30-comment cap              | `getCommentTree` has a max, don't override                     |

## Testing Tools

```typescript
// Mock HnService and ChunkerService
const mockHnService = { search: jest.fn().mockResolvedValue({ hits: [...] }) };
const mockChunkerService = { chunkStories: jest.fn().mockReturnValue([...]) };

// Test tool invocation
const result = await searchHnTool.func({ query: 'rust vs go' });
expect(mockHnService.search).toHaveBeenCalledWith('rust vs go', expect.any(Object));
```

## Common Mistakes

- Returning raw API responses instead of chunked/formatted text
- Not adding Zod `.describe()` on parameters (LLM needs descriptions to use tools correctly)
- Calling LLM provider SDKs directly instead of going through LangChain tool protocol
- Hardcoding token budgets instead of using `LlmService.getMaxContextTokens()`
