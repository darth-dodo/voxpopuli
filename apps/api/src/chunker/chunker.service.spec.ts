import { Test, TestingModule } from '@nestjs/testing';
import { ChunkerService } from './chunker.service';
import type { HnSearchHit, HnComment, StoryChunk, CommentChunk } from '@voxpopuli/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Factory for a fake Algolia search hit. */
function fakeHit(overrides: Partial<HnSearchHit> = {}): HnSearchHit {
  return {
    objectID: '12345',
    title: 'Show HN: A new Rust web framework',
    url: 'https://example.com/rust-web',
    author: 'rustdev',
    points: 150,
    num_comments: 42,
    created_at: '2025-06-15T10:30:00.000Z',
    story_text: null,
    ...overrides,
  };
}

/** Factory for a fake HN comment (pre-flattened with depth). */
function fakeComment(overrides: Partial<HnComment> = {}): HnComment {
  return {
    id: 200,
    type: 'comment',
    by: 'commenter',
    time: 1700000000,
    text: 'This is a great project!',
    parent: 12345,
    kids: [],
    deleted: false,
    dead: false,
    depth: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChunkerService', () => {
  let service: ChunkerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChunkerService],
    }).compile();

    service = module.get<ChunkerService>(ChunkerService);
  });

  // =========================================================================
  // Token estimation
  // =========================================================================

  describe('estimateTokens()', () => {
    it('returns 0 for empty string', () => {
      expect(service.estimateTokens('')).toBe(0);
    });

    it('returns 0 for null/undefined input', () => {
      expect(service.estimateTokens(null as unknown as string)).toBe(0);
      expect(service.estimateTokens(undefined as unknown as string)).toBe(0);
    });

    it('estimates 1 token per 4 characters (ceiling)', () => {
      expect(service.estimateTokens('abcd')).toBe(1); // 4 / 4 = 1
      expect(service.estimateTokens('abcde')).toBe(2); // 5 / 4 = 1.25 -> 2
      expect(service.estimateTokens('a')).toBe(1); // 1 / 4 = 0.25 -> 1
    });

    it('handles longer text correctly', () => {
      const text = 'a'.repeat(100);
      expect(service.estimateTokens(text)).toBe(25); // 100 / 4 = 25
    });
  });

  // =========================================================================
  // HTML stripping
  // =========================================================================

  describe('stripHtml()', () => {
    it('returns null for null input', () => {
      expect(service.stripHtml(null)).toBeNull();
    });

    it('returns empty string for empty input', () => {
      expect(service.stripHtml('')).toBe('');
    });

    it('strips basic HTML tags', () => {
      expect(service.stripHtml('<b>bold</b> and <i>italic</i>')).toBe('bold and italic');
    });

    it('converts <p> tags to paragraph breaks', () => {
      const result = service.stripHtml('<p>First paragraph</p><p>Second paragraph</p>');
      expect(result).toContain('First paragraph');
      expect(result).toContain('Second paragraph');
    });

    it('preserves <pre><code> blocks as markdown fenced code', () => {
      const html = '<p>Here is code:</p><pre><code>const x = 1;\nconst y = 2;</code></pre>';
      const result = service.stripHtml(html);
      expect(result).toContain('```');
      expect(result).toContain('const x = 1;');
      expect(result).toContain('const y = 2;');
    });

    it('preserves standalone <pre> blocks as markdown fenced code', () => {
      const html = '<pre>function hello() { return "world"; }</pre>';
      const result = service.stripHtml(html);
      expect(result).toContain('```');
      expect(result).toContain('function hello()');
    });

    it('converts inline <code> to markdown backticks', () => {
      const html = 'Use the <code>useState</code> hook';
      const result = service.stripHtml(html);
      expect(result).toBe('Use the `useState` hook');
    });

    it('decodes HTML entities', () => {
      const html = '&lt;div&gt; &amp; &quot;quotes&quot;';
      const result = service.stripHtml(html);
      expect(result).toBe('<div> & "quotes"');
    });

    it('converts <a> tags to markdown links', () => {
      const html = 'Check <a href="https://example.com">this link</a>';
      const result = service.stripHtml(html);
      expect(result).toBe('Check [this link](https://example.com)');
    });

    it('handles code blocks with HTML entities inside', () => {
      const html = '<pre><code>if (x &gt; 0 &amp;&amp; y &lt; 10)</code></pre>';
      const result = service.stripHtml(html);
      expect(result).toContain('if (x > 0 && y < 10)');
    });
  });

  // =========================================================================
  // chunkStories()
  // =========================================================================

  describe('chunkStories()', () => {
    it('returns empty array for empty input', () => {
      expect(service.chunkStories([])).toEqual([]);
    });

    it('extracts correct metadata from search hits', () => {
      const hits = [fakeHit()];
      const chunks = service.chunkStories(hits);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].storyId).toBe(12345);
      expect(chunks[0].title).toBe('Show HN: A new Rust web framework');
      expect(chunks[0].author).toBe('rustdev');
      expect(chunks[0].points).toBe(150);
      expect(chunks[0].url).toBe('https://example.com/rust-web');
    });

    it('sets text to null when story_text is null', () => {
      const chunks = service.chunkStories([fakeHit({ story_text: null })]);
      expect(chunks[0].text).toBeNull();
    });

    it('strips HTML from story_text', () => {
      const chunks = service.chunkStories([
        fakeHit({ story_text: '<p>This is an <b>Ask HN</b> post.</p>' }),
      ]);
      expect(chunks[0].text).toBe('This is an Ask HN post.');
    });

    it('calculates token count including metadata', () => {
      const chunks = service.chunkStories([fakeHit({ story_text: null })]);
      // Metadata: "Show HN: A new Rust web framework by rustdev (150 points)"
      expect(chunks[0].tokenCount).toBeGreaterThan(0);
    });

    it('includes story text tokens in token count', () => {
      const withoutText = service.chunkStories([fakeHit({ story_text: null })]);
      const withText = service.chunkStories([
        fakeHit({ story_text: 'A long description of the project that adds tokens.' }),
      ]);
      expect(withText[0].tokenCount).toBeGreaterThan(withoutText[0].tokenCount);
    });

    it('handles multiple hits', () => {
      const hits = [
        fakeHit({ objectID: '1', title: 'First' }),
        fakeHit({ objectID: '2', title: 'Second' }),
        fakeHit({ objectID: '3', title: 'Third' }),
      ];
      const chunks = service.chunkStories(hits);
      expect(chunks).toHaveLength(3);
      expect(chunks.map((c) => c.storyId)).toEqual([1, 2, 3]);
    });
  });

  // =========================================================================
  // chunkComments()
  // =========================================================================

  describe('chunkComments()', () => {
    it('returns empty array for empty input', () => {
      expect(service.chunkComments([])).toEqual([]);
    });

    it('extracts correct fields from comments', () => {
      const chunks = service.chunkComments([fakeComment()]);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].commentId).toBe(200);
      expect(chunks[0].author).toBe('commenter');
      expect(chunks[0].depth).toBe(0);
      expect(chunks[0].text).toBe('This is a great project!');
    });

    it('assigns depth correctly from source comments', () => {
      const comments = [
        fakeComment({ id: 1, depth: 0 }),
        fakeComment({ id: 2, depth: 1 }),
        fakeComment({ id: 3, depth: 2 }),
      ];
      const chunks = service.chunkComments(comments);

      expect(chunks[0].depth).toBe(0);
      expect(chunks[1].depth).toBe(1);
      expect(chunks[2].depth).toBe(2);
    });

    it('filters out deleted comments', () => {
      const comments = [
        fakeComment({ id: 1, deleted: true }),
        fakeComment({ id: 2, deleted: false }),
      ];
      const chunks = service.chunkComments(comments);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].commentId).toBe(2);
    });

    it('filters out dead comments', () => {
      const comments = [fakeComment({ id: 1, dead: true }), fakeComment({ id: 2, dead: false })];
      const chunks = service.chunkComments(comments);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].commentId).toBe(2);
    });

    it('strips HTML from comment text but preserves code blocks', () => {
      const comments = [
        fakeComment({
          text: '<p>Try this:</p><pre><code>npm install foo</code></pre>',
        }),
      ];
      const chunks = service.chunkComments(comments);

      expect(chunks[0].text).toContain('Try this:');
      expect(chunks[0].text).toContain('```');
      expect(chunks[0].text).toContain('npm install foo');
    });

    it('counts tokens for each comment chunk', () => {
      const chunks = service.chunkComments([
        fakeComment({ text: 'short' }),
        fakeComment({
          id: 201,
          text: 'A much longer comment with plenty of words to increase the token count significantly.',
        }),
      ]);

      expect(chunks[0].tokenCount).toBeGreaterThan(0);
      expect(chunks[1].tokenCount).toBeGreaterThan(chunks[0].tokenCount);
    });

    it('sets storyId from comment parent field', () => {
      const chunks = service.chunkComments([fakeComment({ parent: 99999 })]);
      expect(chunks[0].storyId).toBe(99999);
    });
  });

  // =========================================================================
  // buildContext()
  // =========================================================================

  describe('buildContext()', () => {
    const smallStory: StoryChunk = {
      storyId: 1,
      title: 'Test Story',
      author: 'author',
      points: 100,
      url: 'https://example.com',
      text: 'Story body text for testing context building.',
      tokenCount: 20,
    };

    const topComment: CommentChunk = {
      commentId: 10,
      storyId: 1,
      author: 'user1',
      text: 'Top level comment',
      depth: 0,
      tokenCount: 10,
    };

    const nestedComment: CommentChunk = {
      commentId: 11,
      storyId: 1,
      author: 'user2',
      text: 'Nested reply',
      depth: 2,
      tokenCount: 8,
    };

    it('returns empty context for empty inputs', () => {
      const ctx = service.buildContext([], [], 1000);
      expect(ctx.stories).toEqual([]);
      expect(ctx.comments).toEqual([]);
      expect(ctx.totalTokens).toBe(0);
      expect(ctx.truncated).toBe(false);
    });

    it('includes story metadata first (text set to null initially)', () => {
      const ctx = service.buildContext([smallStory], [], 1000);
      expect(ctx.stories).toHaveLength(1);
      expect(ctx.stories[0].storyId).toBe(1);
    });

    it('includes story text when budget allows', () => {
      const ctx = service.buildContext([smallStory], [], 1000);
      expect(ctx.stories[0].text).toBe(smallStory.text);
    });

    it('prioritises top-level comments over nested ones', () => {
      // Budget only fits metadata + one comment
      const metadataText = `${smallStory.title} by ${smallStory.author} (${smallStory.points} points)`;
      const metadataTokens = service.estimateTokens(metadataText);
      const textTokens = service.estimateTokens(smallStory.text as string);

      // Budget: metadata + text + topComment, but not nested
      const budget = metadataTokens + textTokens + topComment.tokenCount + 1;
      const ctx = service.buildContext([smallStory], [topComment, nestedComment], budget);

      expect(ctx.comments).toHaveLength(1);
      expect(ctx.comments[0].commentId).toBe(topComment.commentId);
      expect(ctx.truncated).toBe(true);
    });

    it('includes nested comments when budget remains', () => {
      const ctx = service.buildContext([smallStory], [topComment, nestedComment], 10000);

      expect(ctx.comments).toHaveLength(2);
      expect(ctx.comments.map((c) => c.commentId)).toContain(nestedComment.commentId);
    });

    it('sets truncated flag when items are dropped', () => {
      // Budget too small for anything beyond metadata
      const ctx = service.buildContext([smallStory], [topComment, nestedComment], 5);
      expect(ctx.truncated).toBe(true);
    });

    it('does not set truncated flag when everything fits', () => {
      const ctx = service.buildContext([smallStory], [topComment, nestedComment], 100000);
      expect(ctx.truncated).toBe(false);
    });

    it('tracks total tokens correctly', () => {
      const ctx = service.buildContext([smallStory], [topComment], 100000);
      expect(ctx.totalTokens).toBeGreaterThan(0);
      // Total should equal metadata tokens + text tokens + comment tokens
      const metadataText = `${smallStory.title} by ${smallStory.author} (${smallStory.points} points)`;
      const expectedMetadata = service.estimateTokens(metadataText);
      const expectedText = service.estimateTokens(smallStory.text as string);
      expect(ctx.totalTokens).toBe(expectedMetadata + expectedText + topComment.tokenCount);
    });

    it('handles budget too small for even one story metadata', () => {
      const ctx = service.buildContext([smallStory], [topComment], 0);
      expect(ctx.stories).toHaveLength(0);
      expect(ctx.comments).toHaveLength(0);
      expect(ctx.truncated).toBe(true);
    });

    it('handles depth-1 comments as top-level priority', () => {
      const depth1Comment: CommentChunk = {
        commentId: 12,
        storyId: 1,
        author: 'user3',
        text: 'Depth 1 reply',
        depth: 1,
        tokenCount: 8,
      };

      const metadataText = `${smallStory.title} by ${smallStory.author} (${smallStory.points} points)`;
      const metadataTokens = service.estimateTokens(metadataText);
      const textTokens = service.estimateTokens(smallStory.text as string);

      // Budget fits metadata + text + one comment
      const budget = metadataTokens + textTokens + depth1Comment.tokenCount + 1;
      const ctx = service.buildContext([smallStory], [depth1Comment, nestedComment], budget);

      // Depth 1 should be included as top-level priority
      expect(ctx.comments.some((c) => c.commentId === 12)).toBe(true);
    });

    it('works with provider-specific budgets', () => {
      // Claude: 80k, Mistral: 100k, Groq/Qwen3: 131k (minus 7.5k reserved)
      const claudeBudget = 80000 - 7500;
      const groqBudget = 131000 - 7500;

      const claudeCtx = service.buildContext([smallStory], [topComment], claudeBudget);
      const groqCtx = service.buildContext([smallStory], [topComment], groqBudget);

      // Both should fit everything since chunks are small
      expect(claudeCtx.truncated).toBe(false);
      expect(groqCtx.truncated).toBe(false);
      expect(claudeCtx.totalTokens).toBe(groqCtx.totalTokens);
    });
  });

  // =========================================================================
  // formatForPrompt()
  // =========================================================================

  describe('formatForPrompt()', () => {
    it('returns empty string for empty context', () => {
      const result = service.formatForPrompt({
        stories: [],
        comments: [],
        totalTokens: 0,
        truncated: false,
      });
      expect(result).toBe('');
    });

    it('formats stories with metadata', () => {
      const ctx = {
        stories: [
          {
            storyId: 1,
            title: 'Test Story',
            author: 'author',
            points: 100,
            url: 'https://example.com',
            text: null,
            tokenCount: 10,
          },
        ] satisfies StoryChunk[],
        comments: [],
        totalTokens: 10,
        truncated: false,
      };

      const result = service.formatForPrompt(ctx);
      expect(result).toContain('=== STORIES ===');
      expect(result).toContain('[1] "Test Story" by author (100 points)');
      expect(result).toContain('URL: https://example.com');
    });

    it('includes story text when present', () => {
      const ctx = {
        stories: [
          {
            storyId: 1,
            title: 'Ask HN',
            author: 'user',
            points: 50,
            url: null,
            text: 'What is the best language?',
            tokenCount: 15,
          },
        ] satisfies StoryChunk[],
        comments: [],
        totalTokens: 15,
        truncated: false,
      };

      const result = service.formatForPrompt(ctx);
      expect(result).toContain('Text: What is the best language?');
      expect(result).not.toContain('URL:'); // null url should be omitted
    });

    it('formats comments with depth indication', () => {
      const ctx = {
        stories: [],
        comments: [
          {
            commentId: 10,
            storyId: 1,
            author: 'user1',
            text: 'Top comment',
            depth: 0,
            tokenCount: 5,
          },
          {
            commentId: 11,
            storyId: 1,
            author: 'user2',
            text: 'Reply',
            depth: 2,
            tokenCount: 3,
          },
        ] satisfies CommentChunk[],
        totalTokens: 8,
        truncated: false,
      };

      const result = service.formatForPrompt(ctx);
      expect(result).toContain('=== COMMENTS ===');
      expect(result).toContain('[Story 1] user1 (depth 0): Top comment');
      expect(result).toContain('[Story 1]     user2 (depth 2): Reply');
    });

    it('appends truncation notice when truncated', () => {
      const ctx = {
        stories: [],
        comments: [],
        totalTokens: 0,
        truncated: true,
      };

      const result = service.formatForPrompt(ctx);
      expect(result).toContain('Context was truncated to fit token budget');
    });

    it('does not include truncation notice when not truncated', () => {
      const ctx = {
        stories: [
          {
            storyId: 1,
            title: 'Test',
            author: 'a',
            points: 1,
            url: null,
            text: null,
            tokenCount: 5,
          },
        ] satisfies StoryChunk[],
        comments: [],
        totalTokens: 5,
        truncated: false,
      };

      const result = service.formatForPrompt(ctx);
      expect(result).not.toContain('truncated');
    });

    it('renders full context with stories and comments', () => {
      const ctx = {
        stories: [
          {
            storyId: 42,
            title: 'Rust vs Go',
            author: 'dev',
            points: 200,
            url: 'https://blog.example.com',
            text: 'Comparing performance characteristics.',
            tokenCount: 20,
          },
        ] satisfies StoryChunk[],
        comments: [
          {
            commentId: 100,
            storyId: 42,
            author: 'gopher',
            text: 'Go is simpler for most use cases.',
            depth: 0,
            tokenCount: 10,
          },
          {
            commentId: 101,
            storyId: 42,
            author: 'rustacean',
            text: 'Rust is safer with zero-cost abstractions.',
            depth: 1,
            tokenCount: 12,
          },
        ] satisfies CommentChunk[],
        totalTokens: 42,
        truncated: false,
      };

      const result = service.formatForPrompt(ctx);

      // Stories section
      expect(result).toContain('=== STORIES ===');
      expect(result).toContain('[42] "Rust vs Go" by dev (200 points)');
      expect(result).toContain('URL: https://blog.example.com');
      expect(result).toContain('Text: Comparing performance characteristics.');

      // Comments section
      expect(result).toContain('=== COMMENTS ===');
      expect(result).toContain('gopher (depth 0): Go is simpler');
      expect(result).toContain('rustacean (depth 1): Rust is safer');
    });
  });
});
