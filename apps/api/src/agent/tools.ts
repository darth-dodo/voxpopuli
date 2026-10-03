import { tool } from 'langchain';
import { z } from 'zod';
import type { HnService } from '../hn/hn.service';
import type { ChunkerService } from '../chunker/chunker.service';
import type { HnStory, SourceMetadata } from '@voxpopuli/shared-types';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Per-request registry of every story the tools surfaced, keyed by storyId.
 * Lets the pipeline build its source table from structured API data instead
 * of asking the LLM to transcribe it (slow, and prone to null/invented fields).
 */
export type SourceRegistry = Map<number, SourceMetadata>;

/**
 * A `min_points`-filtered search returning fewer stories than this is retried once
 * without the filter. Models often pick thresholds (50-100 points) that leave 0-1
 * results for niche topics, which then produce confident answers from one story.
 */
export const MIN_FILTERED_HITS = 3;

/** Canonical HN discussion URL — used when a story has no external link (Ask HN, etc.). */
export function hnItemUrl(storyId: number): string {
  return `https://news.ycombinator.com/item?id=${storyId}`;
}

/**
 * Create the `search_hn` tool for the ReAct agent.
 *
 * Searches HN stories via Algolia, chunks the results through
 * {@link ChunkerService}, and returns a formatted string.
 */
export function createSearchHnTool(
  hn: HnService,
  chunker: ChunkerService,
  sources?: SourceRegistry,
): StructuredToolInterface {
  return tool(
    async (input: {
      query: string;
      sort_by?: 'relevance' | 'date';
      min_points?: number;
      max_results?: number;
    }): Promise<string> => {
      const search = (minPoints?: number) =>
        input.sort_by === 'date'
          ? hn.searchByDate(input.query, { minPoints, hitsPerPage: input.max_results })
          : hn.search(input.query, { minPoints, hitsPerPage: input.max_results });

      let result = await search(input.min_points);
      let note = '';
      if (input.min_points && input.min_points > 1 && result.hits.length < MIN_FILTERED_HITS) {
        const relaxed = await search(undefined);
        const had = `${result.hits.length} ${result.hits.length === 1 ? 'story' : 'stories'}`;
        if (relaxed.hits.length > result.hits.length) {
          note = `Note: only ${had} had ${input.min_points}+ points, so the points filter was removed for this search.\n`;
          result = relaxed;
        } else {
          // Tell the model, or it re-runs the same search without the filter itself.
          note = `Note: removing the points filter found no additional stories; don't repeat this search without it.\n`;
        }
      }

      if (result.hits.length === 0) {
        return 'No results found for this search query.';
      }

      for (const hit of result.hits) {
        const storyId = parseInt(hit.objectID, 10);
        sources?.set(storyId, {
          storyId,
          title: hit.title,
          url: hit.url || hnItemUrl(storyId),
          author: hit.author,
          points: hit.points ?? 0,
          commentCount: hit.num_comments ?? 0,
          postedDate: hit.created_at ? hit.created_at.slice(0, 10) : undefined,
        });
      }

      const chunks = chunker.chunkStories(result.hits);
      const context = chunker.buildContext(chunks, [], Infinity);
      return note + chunker.formatForPrompt(context);
    },
    {
      name: 'search_hn',
      description:
        'Search Hacker News stories via Algolia. Returns story titles, authors, points, and URLs. Use for finding relevant discussions on a topic.',
      schema: z.object({
        query: z.string().describe('Search keywords'),
        sort_by: z
          .enum(['relevance', 'date'])
          .optional()
          .describe('Sort order: relevance (default) or date'),
        min_points: z.coerce.number().optional().describe('Minimum points filter'),
        max_results: z.coerce
          .number()
          .min(1)
          .max(20)
          .optional()
          .describe('Number of results (1-20, default 10)'),
      }),
    },
  );
}

/**
 * Create the `get_story` tool for the ReAct agent.
 *
 * Fetches a single HN story by ID from the Firebase API and
 * returns its full details as a formatted string.
 */
export function createGetStoryTool(
  hn: HnService,
  chunker: ChunkerService,
  sources?: SourceRegistry,
): StructuredToolInterface {
  return tool(
    async (input: { story_id: number }): Promise<string> => {
      const item = await hn.getItem(input.story_id);

      if (!item || item.type !== 'story') {
        return `No story found with ID ${input.story_id}.`;
      }

      const story = item as HnStory;
      sources?.set(story.id, {
        storyId: story.id,
        title: story.title,
        url: story.url || hnItemUrl(story.id),
        author: story.by,
        points: story.score ?? 0,
        commentCount: story.descendants ?? 0,
        postedDate: new Date(story.time * 1000).toISOString().slice(0, 10),
      });
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
    {
      name: 'get_story',
      description:
        'Fetch a single Hacker News story by its ID. Returns full story details including title, author, points, URL, and text body.',
      schema: z.object({
        story_id: z.coerce.number().describe('The HN story ID'),
      }),
    },
  );
}

/**
 * Create the `get_comments` tool for the ReAct agent.
 *
 * Fetches the comment tree for a given story, chunks and formats
 * the comments for LLM consumption. Capped at 30 comments.
 */
export function createGetCommentsTool(
  hn: HnService,
  chunker: ChunkerService,
): StructuredToolInterface {
  return tool(
    async (input: { story_id: number; max_depth?: number }): Promise<string> => {
      const comments = await hn.getCommentTree(input.story_id, input.max_depth);

      if (comments.length === 0) {
        return `No comments found for story ${input.story_id}.`;
      }

      const chunks = chunker.chunkComments(comments);
      const context = chunker.buildContext([], chunks, Infinity);
      return chunker.formatForPrompt(context);
    },
    {
      name: 'get_comments',
      description:
        'Fetch comments for a Hacker News story. Returns up to 30 comments with author, depth, and text. Use to find insights and opinions from the HN community.',
      schema: z.object({
        story_id: z.coerce.number().describe('The parent story ID'),
        max_depth: z.coerce
          .number()
          .min(1)
          .max(5)
          .optional()
          .describe('Maximum comment tree depth (1-5, default 3)'),
      }),
    },
  );
}

/**
 * Create all agent tools for the VoxPopuli ReAct agent.
 *
 * @param hn      - HnService instance for HN API calls
 * @param chunker - ChunkerService instance for token-aware formatting
 * @param sources - Optional registry that collects every story the tools surface
 * @returns Array of LangChain tool instances
 */
export function createAgentTools(
  hn: HnService,
  chunker: ChunkerService,
  sources?: SourceRegistry,
): StructuredToolInterface[] {
  return [
    createSearchHnTool(hn, chunker, sources),
    createGetStoryTool(hn, chunker, sources),
    createGetCommentsTool(hn, chunker),
  ];
}
