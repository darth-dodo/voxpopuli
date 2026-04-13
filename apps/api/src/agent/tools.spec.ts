/* eslint-disable @typescript-eslint/no-explicit-any */
import type { HnStory } from '@voxpopuli/shared-types';

// ---------------------------------------------------------------------------
// Mock langchain *before* importing the tools module
// ---------------------------------------------------------------------------

jest.mock('langchain', () => ({
  tool: jest.fn((fn: (...args: any[]) => any, config: any) => ({
    invoke: fn,
    name: config.name,
    description: config.description,
    schema: config.schema,
  })),
}));

import {
  createSearchHnTool,
  createGetStoryTool,
  createGetCommentsTool,
  createAgentTools,
} from './tools';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

function createMockHnService() {
  return {
    search: jest.fn(),
    searchByDate: jest.fn(),
    getItem: jest.fn(),
    getCommentTree: jest.fn(),
  };
}

function createMockChunkerService() {
  return {
    chunkStories: jest.fn((hits: any[]) => hits),
    chunkComments: jest.fn((comments: any[]) => comments),
    buildContext: jest.fn((_stories: any[], _comments: any[], _budget?: number) => ({
      stories: _stories,
      comments: _comments,
    })),
    formatForPrompt: jest.fn(() => 'formatted output'),
    stripHtml: jest.fn((text: string | null) => text),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSearchHnTool', () => {
  let hn: ReturnType<typeof createMockHnService>;
  let chunker: ReturnType<typeof createMockChunkerService>;
  let searchTool: any;

  beforeEach(() => {
    hn = createMockHnService();
    chunker = createMockChunkerService();
    searchTool = createSearchHnTool(hn as any, chunker as any);
  });

  it('should have the correct name', () => {
    expect(searchTool.name).toBe('search_hn');
  });

  it('should call hn.search for relevance sort (default)', async () => {
    hn.search.mockResolvedValue({ hits: [{ id: 1, title: 'Test' }] });

    const result = await searchTool.invoke({ query: 'rust lang' });

    expect(hn.search).toHaveBeenCalledWith('rust lang', {
      minPoints: undefined,
      hitsPerPage: undefined,
    });
    expect(result).toBe('formatted output');
  });

  it('should call hn.search for explicit relevance sort', async () => {
    hn.search.mockResolvedValue({ hits: [{ id: 1 }] });

    await searchTool.invoke({ query: 'test', sort_by: 'relevance' });

    expect(hn.search).toHaveBeenCalled();
    expect(hn.searchByDate).not.toHaveBeenCalled();
  });

  it('should call hn.searchByDate for date sort', async () => {
    hn.searchByDate.mockResolvedValue({ hits: [{ id: 1 }] });

    await searchTool.invoke({ query: 'test', sort_by: 'date' });

    expect(hn.searchByDate).toHaveBeenCalledWith('test', {
      minPoints: undefined,
      hitsPerPage: undefined,
    });
    expect(hn.search).not.toHaveBeenCalled();
  });

  it('should pass min_points and max_results options', async () => {
    hn.search.mockResolvedValue({ hits: [{ id: 1 }] });

    await searchTool.invoke({ query: 'test', min_points: 50, max_results: 5 });

    expect(hn.search).toHaveBeenCalledWith('test', {
      minPoints: 50,
      hitsPerPage: 5,
    });
  });

  it('should return "No results found" on empty hits', async () => {
    hn.search.mockResolvedValue({ hits: [] });

    const result = await searchTool.invoke({ query: 'nonexistent' });

    expect(result).toBe('No results found for this search query.');
    expect(chunker.chunkStories).not.toHaveBeenCalled();
  });

  it('should pipe results through chunker pipeline', async () => {
    const hits = [{ id: 1 }, { id: 2 }];
    hn.search.mockResolvedValue({ hits });

    await searchTool.invoke({ query: 'test' });

    expect(chunker.chunkStories).toHaveBeenCalledWith(hits);
    expect(chunker.buildContext).toHaveBeenCalledWith(hits, [], Infinity);
    expect(chunker.formatForPrompt).toHaveBeenCalled();
  });
});

describe('createGetStoryTool', () => {
  let hn: ReturnType<typeof createMockHnService>;
  let chunker: ReturnType<typeof createMockChunkerService>;
  let storyTool: any;

  beforeEach(() => {
    hn = createMockHnService();
    chunker = createMockChunkerService();
    storyTool = createGetStoryTool(hn as any, chunker as any);
  });

  it('should have the correct name', () => {
    expect(storyTool.name).toBe('get_story');
  });

  it('should format a full story with url and text', async () => {
    const story: HnStory = {
      id: 123,
      type: 'story',
      by: 'author1',
      time: Math.floor(new Date('2024-06-15').getTime() / 1000),
      title: 'Test Story',
      url: 'https://example.com/article',
      text: 'Story body text',
      score: 200,
      descendants: 50,
    };
    hn.getItem.mockResolvedValue(story);

    const result = await storyTool.invoke({ story_id: 123 });

    expect(result).toContain('[123]');
    expect(result).toContain('"Test Story"');
    expect(result).toContain('by author1');
    expect(result).toContain('200 points');
    expect(result).toContain('50 comments');
    expect(result).toContain('URL: https://example.com/article');
    expect(result).toContain('Text: Story body text');
    expect(result).toContain('Posted: 2024-06-15');
  });

  it('should handle missing story (null)', async () => {
    hn.getItem.mockResolvedValue(null);

    const result = await storyTool.invoke({ story_id: 999 });

    expect(result).toBe('No story found with ID 999.');
  });

  it('should handle non-story item type', async () => {
    hn.getItem.mockResolvedValue({ id: 999, type: 'comment', by: 'user' });

    const result = await storyTool.invoke({ story_id: 999 });

    expect(result).toBe('No story found with ID 999.');
  });

  it('should handle missing url', async () => {
    const story: HnStory = {
      id: 100,
      type: 'story',
      by: 'author',
      time: Math.floor(Date.now() / 1000),
      title: 'Ask HN: Something',
      score: 10,
      descendants: 5,
    };
    hn.getItem.mockResolvedValue(story);

    const result = await storyTool.invoke({ story_id: 100 });

    expect(result).not.toContain('URL:');
    expect(result).toContain('Posted:');
  });

  it('should handle missing text', async () => {
    const story: HnStory = {
      id: 100,
      type: 'story',
      by: 'author',
      time: Math.floor(Date.now() / 1000),
      title: 'Link Story',
      url: 'https://example.com',
      score: 10,
      descendants: 5,
    };
    chunker.stripHtml.mockReturnValue(null);
    hn.getItem.mockResolvedValue(story);

    const result = await storyTool.invoke({ story_id: 100 });

    expect(result).not.toContain('Text:');
  });

  it('should include Posted date in ISO format', async () => {
    const story: HnStory = {
      id: 1,
      type: 'story',
      by: 'user',
      time: Math.floor(new Date('2023-01-15T12:00:00Z').getTime() / 1000),
      title: 'Test',
      score: 1,
      descendants: 0,
    };
    hn.getItem.mockResolvedValue(story);

    const result = await storyTool.invoke({ story_id: 1 });

    expect(result).toContain('Posted: 2023-01-15');
  });

  it('should default descendants to 0 when missing', async () => {
    const story = {
      id: 1,
      type: 'story',
      by: 'user',
      time: Math.floor(Date.now() / 1000),
      title: 'Test',
      score: 1,
      descendants: undefined,
    };
    hn.getItem.mockResolvedValue(story);

    const result = await storyTool.invoke({ story_id: 1 });

    expect(result).toContain('0 comments');
  });
});

describe('createGetCommentsTool', () => {
  let hn: ReturnType<typeof createMockHnService>;
  let chunker: ReturnType<typeof createMockChunkerService>;
  let commentsTool: any;

  beforeEach(() => {
    hn = createMockHnService();
    chunker = createMockChunkerService();
    commentsTool = createGetCommentsTool(hn as any, chunker as any);
  });

  it('should have the correct name', () => {
    expect(commentsTool.name).toBe('get_comments');
  });

  it('should fetch and format comments', async () => {
    const comments = [
      { id: 1, text: 'Great post', by: 'user1' },
      { id: 2, text: 'Disagree', by: 'user2' },
    ];
    hn.getCommentTree.mockResolvedValue(comments);

    const result = await commentsTool.invoke({ story_id: 123 });

    expect(hn.getCommentTree).toHaveBeenCalledWith(123, undefined);
    expect(chunker.chunkComments).toHaveBeenCalledWith(comments);
    expect(chunker.buildContext).toHaveBeenCalledWith([], comments, Infinity);
    expect(result).toBe('formatted output');
  });

  it('should pass max_depth to getCommentTree', async () => {
    hn.getCommentTree.mockResolvedValue([{ id: 1 }]);

    await commentsTool.invoke({ story_id: 123, max_depth: 2 });

    expect(hn.getCommentTree).toHaveBeenCalledWith(123, 2);
  });

  it('should handle empty comments', async () => {
    hn.getCommentTree.mockResolvedValue([]);

    const result = await commentsTool.invoke({ story_id: 456 });

    expect(result).toBe('No comments found for story 456.');
    expect(chunker.chunkComments).not.toHaveBeenCalled();
  });
});

describe('createAgentTools', () => {
  it('should return an array of 3 tools', () => {
    const hn = createMockHnService();
    const chunker = createMockChunkerService();

    const tools = createAgentTools(hn as any, chunker as any);

    expect(tools).toHaveLength(3);
    expect(tools.map((t: any) => t.name)).toEqual(['search_hn', 'get_story', 'get_comments']);
  });
});
