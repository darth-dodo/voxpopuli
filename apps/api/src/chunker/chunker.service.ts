import { Injectable } from '@nestjs/common';
import type {
  HnSearchHit,
  HnComment,
  StoryChunk,
  CommentChunk,
  ContextWindow,
} from '@voxpopuli/shared-types';

/**
 * Service responsible for chunking Hacker News stories and comments into
 * token-counted segments, assembling them into a context window that fits
 * within an LLM provider's token budget, and rendering the final prompt.
 */
@Injectable()
export class ChunkerService {
  /**
   * Estimate token count for a text string.
   * Uses the common heuristic of 1 token per 4 characters for v1.
   *
   * @param text - The text to estimate tokens for
   * @returns Estimated token count (minimum 0)
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Strip HTML tags from a string while preserving content inside
   * `<code>` and `<pre>` blocks by converting them to markdown
   * fenced code blocks.
   *
   * @param html - Raw HTML string (may be null)
   * @returns Cleaned text with code blocks preserved as markdown
   */
  stripHtml(html: string | null): string | null {
    if (html === null || html === undefined) return null;
    if (html === '') return '';

    let text = html;

    // Convert <pre><code>...</code></pre> and standalone <pre>...</pre>
    // to markdown fenced code blocks.
    text = text.replace(
      /<pre><code>([\s\S]*?)<\/code><\/pre>/gi,
      (_match, content: string) => `\n\`\`\`\n${this.decodeHtmlEntities(content.trim())}\n\`\`\`\n`,
    );
    text = text.replace(
      /<pre>([\s\S]*?)<\/pre>/gi,
      (_match, content: string) => `\n\`\`\`\n${this.decodeHtmlEntities(content.trim())}\n\`\`\`\n`,
    );

    // Convert standalone <code>...</code> to inline markdown code.
    text = text.replace(
      /<code>([\s\S]*?)<\/code>/gi,
      (_match, content: string) => `\`${this.decodeHtmlEntities(content)}\``,
    );

    // Convert <p> tags to double newlines for paragraph separation.
    text = text.replace(/<p>/gi, '\n\n');

    // Convert <br> / <br/> to single newlines.
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Convert <a href="...">text</a> to markdown links.
    text = text.replace(
      /<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, linkText: string) => `[${linkText}](${href})`,
    );

    // Strip all remaining HTML tags.
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities in the final output.
    text = this.decodeHtmlEntities(text);

    // Normalize whitespace: collapse multiple blank lines into at most two.
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
  }

  /**
   * Chunk an array of Algolia search hits into token-counted story chunks.
   *
   * @param hits - Array of {@link HnSearchHit} from Algolia search
   * @returns Array of {@link StoryChunk} with metadata, stripped text, and token counts
   */
  chunkStories(hits: HnSearchHit[]): StoryChunk[] {
    return hits.map((hit) => {
      const text = this.stripHtml(hit.story_text);
      const postedDate = hit.created_at
        ? new Date(hit.created_at).toISOString().split('T')[0]
        : null;
      const metadataText = `${hit.title} by ${hit.author} (${hit.points} points)`;
      const fullText = text ? `${metadataText}\n${text}` : metadataText;

      return {
        storyId: parseInt(hit.objectID, 10),
        title: hit.title,
        author: hit.author,
        points: hit.points,
        url: hit.url,
        text,
        postedDate,
        tokenCount: this.estimateTokens(fullText),
      };
    });
  }

  /**
   * Chunk an array of HN comments into token-counted comment chunks.
   * Filters out deleted and dead comments. Comments arrive pre-flattened
   * with depth already assigned by {@link HnService.getCommentTree}.
   *
   * @param comments - Array of {@link HnComment} from the comment tree
   * @returns Array of {@link CommentChunk} with depth, stripped text, and token counts
   */
  chunkComments(comments: HnComment[]): CommentChunk[] {
    return comments
      .filter((c) => !c.deleted && !c.dead)
      .map((comment) => {
        const text = this.stripHtml(comment.text) ?? '';
        const fullText = `${comment.by}: ${text}`;

        return {
          commentId: comment.id,
          storyId: comment.parent,
          author: comment.by,
          text,
          depth: comment.depth,
          tokenCount: this.estimateTokens(fullText),
        };
      });
  }

  /**
   * Assemble story and comment chunks into a context window that fits
   * within the given token budget.
   *
   * Priority order:
   * 1. Story metadata (title, author, points) -- always included
   * 2. Story text (Ask HN / Show HN bodies) -- if budget allows
   * 3. Top-level comments (depth 0-1) -- highest priority comments
   * 4. Nested comments (depth 2+) -- if budget remains
   *
   * The caller is responsible for subtracting reserved tokens (system prompt,
   * agent reasoning, per-step overhead) before passing the budget.
   *
   * @param stories  - Token-counted story chunks
   * @param comments - Token-counted comment chunks
   * @param budget   - Available token budget (already adjusted for overhead)
   * @returns {@link ContextWindow} with fitted chunks and truncation flag
   */
  buildContext(stories: StoryChunk[], comments: CommentChunk[], budget: number): ContextWindow {
    let remaining = budget;
    let truncated = false;
    const includedStories: StoryChunk[] = [];
    const includedComments: CommentChunk[] = [];

    // Phase 1: Story metadata (always included if budget allows).
    // Metadata-only token cost is calculated without the story text.
    for (const story of stories) {
      const metadataText = `${story.title} by ${story.author} (${story.points} points)`;
      const metadataTokens = this.estimateTokens(metadataText);

      if (metadataTokens <= remaining) {
        includedStories.push({
          ...story,
          text: null, // Text added in phase 2 if budget allows
          tokenCount: metadataTokens,
        });
        remaining -= metadataTokens;
      } else {
        truncated = true;
      }
    }

    // Phase 2: Story text bodies (Ask HN / Show HN).
    for (let i = 0; i < includedStories.length; i++) {
      const originalStory = stories[i];
      if (!originalStory.text) continue;

      const textTokens = this.estimateTokens(originalStory.text);
      if (textTokens <= remaining) {
        includedStories[i] = {
          ...includedStories[i],
          text: originalStory.text,
          tokenCount: includedStories[i].tokenCount + textTokens,
        };
        remaining -= textTokens;
      } else {
        truncated = true;
      }
    }

    // Phase 3: Top-level comments (depth 0-1).
    const topLevel = comments.filter((c) => c.depth <= 1);
    for (const comment of topLevel) {
      if (comment.tokenCount <= remaining) {
        includedComments.push(comment);
        remaining -= comment.tokenCount;
      } else {
        truncated = true;
      }
    }

    // Phase 4: Nested comments (depth 2+).
    const nested = comments.filter((c) => c.depth >= 2);
    for (const comment of nested) {
      if (comment.tokenCount <= remaining) {
        includedComments.push(comment);
        remaining -= comment.tokenCount;
      } else {
        truncated = true;
      }
    }

    const totalTokens = budget - remaining;

    return {
      stories: includedStories,
      comments: includedComments,
      totalTokens,
      truncated,
    };
  }

  /**
   * Render a context window as an LLM-ready prompt string.
   *
   * Format:
   * ```
   * === STORIES ===
   * [1] "Title" by author (N points)
   *     URL: ...
   *     Text: ...
   *
   * === COMMENTS ===
   * [Story N] author (depth D): comment text
   * ```
   *
   * @param context - The assembled {@link ContextWindow}
   * @returns Formatted prompt string ready for LLM injection
   */
  formatForPrompt(context: ContextWindow): string {
    const parts: string[] = [];

    if (context.stories.length > 0) {
      parts.push('=== STORIES ===');
      for (const story of context.stories) {
        const lines: string[] = [];
        lines.push(
          `[${story.storyId}] "${story.title}" by ${story.author} (${story.points} points)`,
        );
        if (story.url) {
          lines.push(`  URL: ${story.url}`);
        }
        if (story.text) {
          lines.push(`  Text: ${story.text}`);
        }
        if (story.postedDate) {
          lines.push(`  Posted: ${story.postedDate}`);
        }
        parts.push(lines.join('\n'));
      }
    }

    if (context.comments.length > 0) {
      parts.push('=== COMMENTS ===');
      for (const comment of context.comments) {
        const indent = '  '.repeat(comment.depth);
        parts.push(
          `[Story ${comment.storyId}] ${indent}${comment.author} (depth ${comment.depth}): ${comment.text}`,
        );
      }
    }

    if (context.truncated) {
      parts.push('=== NOTE: Context was truncated to fit token budget ===');
    }

    return parts.join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Decode common HTML entities to their text equivalents.
   */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&nbsp;/g, ' ');
  }
}
