import { DynamicTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { HnService } from '../hn/hn.service';
import type { ChunkerService } from '../chunker/chunker.service';

/**
 * Create the `search_hn` tool for the ReAct agent.
 *
 * Searches HN stories via Algolia, chunks the results through
 * {@link ChunkerService}, and returns a formatted string.
 */
export function createSearchHnTool(hn: HnService, chunker: ChunkerService): DynamicTool {
  return new DynamicTool({
    name: 'search_hn',
    description:
      'Search Hacker News stories via Algolia. Returns story titles, authors, points, and URLs. Use for finding relevant discussions on a topic.',
    schema: z.object({
      query: z.string().describe('Search keywords'),
      sort_by: z
        .enum(['relevance', 'date'])
        .optional()
        .describe('Sort order: relevance (default) or date'),
      min_points: z.number().optional().describe('Minimum points filter'),
      max_results: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe('Number of results (1-20, default 10)'),
    }),
    func: async (input: {
      query: string;
      sort_by?: 'relevance' | 'date';
      min_points?: number;
      max_results?: number;
    }): Promise<string> => {
      const result =
        input.sort_by === 'date'
          ? await hn.searchByDate(input.query, {
              minPoints: input.min_points,
              hitsPerPage: input.max_results,
            })
          : await hn.search(input.query, {
              minPoints: input.min_points,
              hitsPerPage: input.max_results,
            });

      if (result.hits.length === 0) {
        return 'No results found for this search query.';
      }

      const chunks = chunker.chunkStories(result.hits);
      const context = chunker.buildContext(chunks, [], Infinity);
      return chunker.formatForPrompt(context);
    },
  });
}

/**
 * Create the `get_story` tool for the ReAct agent.
 *
 * Fetches a single HN story by ID from the Firebase API and
 * returns its full details as a formatted string.
 */
export function createGetStoryTool(hn: HnService, chunker: ChunkerService): DynamicTool {
  return new DynamicTool({
    name: 'get_story',
    description:
      'Fetch a single Hacker News story by its ID. Returns full story details including title, author, points, URL, and text body.',
    schema: z.object({
      story_id: z.number().describe('The HN story ID'),
    }),
    func: async (input: { story_id: number }): Promise<string> => {
      const item = await hn.getItem(input.story_id);

      if (!item || item.type !== 'story') {
        return `No story found with ID ${input.story_id}.`;
      }

      const story = item as import('@voxpopuli/shared-types').HnStory;
      const text = chunker.stripHtml(story.text ?? null);
      const lines: string[] = [
        `[${story.id}] "${story.title}" by ${story.by} (${story.score} points, ${
          story.descendants ?? 0
        } comments)`,
      ];
      if (story.url) lines.push(`URL: ${story.url}`);
      if (text) lines.push(`Text: ${text}`);
      lines.push(`Posted: ${new Date(story.time * 1000).toISOString().split('T')[0]}`);

      return lines.join('\n');
    },
  });
}

/**
 * Create the `get_comments` tool for the ReAct agent.
 *
 * Fetches the comment tree for a given story, chunks and formats
 * the comments for LLM consumption. Capped at 30 comments.
 */
export function createGetCommentsTool(hn: HnService, chunker: ChunkerService): DynamicTool {
  return new DynamicTool({
    name: 'get_comments',
    description:
      'Fetch comments for a Hacker News story. Returns up to 30 comments with author, depth, and text. Use to find insights and opinions from the HN community.',
    schema: z.object({
      story_id: z.number().describe('The parent story ID'),
      max_depth: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe('Maximum comment tree depth (1-5, default 3)'),
    }),
    func: async (input: { story_id: number; max_depth?: number }): Promise<string> => {
      const comments = await hn.getCommentTree(input.story_id, input.max_depth);

      if (comments.length === 0) {
        return `No comments found for story ${input.story_id}.`;
      }

      const chunks = chunker.chunkComments(comments);
      const context = chunker.buildContext([], chunks, Infinity);
      return chunker.formatForPrompt(context);
    },
  });
}

/**
 * Create all agent tools for the VoxPopuli ReAct agent.
 *
 * @param hn      - HnService instance for HN API calls
 * @param chunker - ChunkerService instance for token-aware formatting
 * @returns Array of LangChain DynamicTool instances
 */
export function createAgentTools(hn: HnService, chunker: ChunkerService): DynamicTool[] {
  return [
    createSearchHnTool(hn, chunker),
    createGetStoryTool(hn, chunker),
    createGetCommentsTool(hn, chunker),
  ];
}
