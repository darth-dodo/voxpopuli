import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CacheService } from '../cache/cache.service';
import type { HnSearchResult, HnSearchOptions, HnStory, HnComment } from '@voxpopuli/shared-types';

/** TTL constants in seconds */
const TTL_SEARCH = 900; // 15 min
const TTL_STORY = 3600; // 1 hr
const TTL_COMMENT = 1800; // 30 min

/** Maximum comments returned by getCommentTree */
const MAX_COMMENTS = 30;

/** Maximum concurrent Firebase item fetches per batch */
const BATCH_SIZE = 10;

/** Maximum top-level comments to fetch */
const MAX_TOP_LEVEL = 15;

/** Algolia search base URL */
const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

/** Firebase HN API base URL */
const FIREBASE_BASE = 'https://hacker-news.firebaseio.com/v0';

/**
 * Raw item shape from the Firebase HN API before we assign the `depth` field.
 * Covers both stories and comments.
 */
interface FirebaseItem {
  id: number;
  type: string;
  by: string;
  time: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  parent?: number;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
}

/**
 * Service for fetching Hacker News data from Algolia (search) and
 * the official Firebase API (individual items and comment trees).
 */
@Injectable()
export class HnService {
  private readonly logger = new Logger(HnService.name);

  constructor(private readonly http: HttpService, private readonly cache: CacheService) {}

  /**
   * Search HN stories via the Algolia relevance-sorted endpoint.
   *
   * @param query   - Search query string
   * @param options - Optional filters (minPoints, hitsPerPage)
   * @returns Algolia search results typed as {@link HnSearchResult}
   */
  async search(query: string, options?: HnSearchOptions): Promise<HnSearchResult> {
    const cacheKey = `hn:search:${query}:${JSON.stringify(options ?? {})}`;
    return this.cache.getOrSet(
      cacheKey,
      () => this.fetchAlgolia('search', query, options),
      TTL_SEARCH,
    );
  }

  /**
   * Search HN stories via the Algolia date-sorted endpoint.
   *
   * @param query   - Search query string
   * @param options - Optional filters (minPoints, hitsPerPage)
   * @returns Algolia search results typed as {@link HnSearchResult}
   */
  async searchByDate(query: string, options?: HnSearchOptions): Promise<HnSearchResult> {
    const cacheKey = `hn:search_by_date:${query}:${JSON.stringify(options ?? {})}`;
    return this.cache.getOrSet(
      cacheKey,
      () => this.fetchAlgolia('search_by_date', query, options),
      TTL_SEARCH,
    );
  }

  /**
   * Fetch a single HN item (story or comment) from the Firebase API.
   *
   * @param id - The Hacker News item ID
   * @returns The item data typed as {@link HnStory} or {@link HnComment}
   */
  async getItem(id: number): Promise<HnStory | HnComment> {
    const cacheKey = `hn:item:${id}`;
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const { data } = await firstValueFrom(
          this.http.get<FirebaseItem>(`${FIREBASE_BASE}/item/${id}.json`),
        );
        return data as unknown as HnStory | HnComment;
      },
      TTL_STORY,
    );
  }

  /**
   * Build a comment tree for a given story, fetching comments in parallel
   * batches.
   *
   * - Fetches up to 15 top-level comments
   * - For each with kids[], fetches up to 3 replies
   * - Hard cap of 30 comments total
   * - Skips deleted/dead comments (they don't count toward cap)
   * - Each comment is individually cached for 1800 seconds
   *
   * @param storyId  - The HN story ID
   * @param maxDepth - Maximum comment tree depth (default 3)
   * @returns Array of {@link HnComment} with assigned depth values
   */
  async getCommentTree(storyId: number, maxDepth = 3): Promise<HnComment[]> {
    const story = await this.getItem(storyId);
    const kidIds = 'kids' in story && story.kids ? story.kids : [];

    if (kidIds.length === 0) {
      return [];
    }

    const comments: HnComment[] = [];
    const topLevelIds = kidIds.slice(0, MAX_TOP_LEVEL);

    // Fetch top-level comments in batches
    const topLevel = await this.fetchCommentBatch(topLevelIds, 0);

    for (const comment of topLevel) {
      if (comments.length >= MAX_COMMENTS) break;
      comments.push(comment);

      // Fetch replies if within depth and cap
      if (
        maxDepth > 1 &&
        comment.kids &&
        comment.kids.length > 0 &&
        comments.length < MAX_COMMENTS
      ) {
        const replyIds = comment.kids.slice(0, 3);
        const replies = await this.fetchCommentBatch(replyIds, 1);

        for (const reply of replies) {
          if (comments.length >= MAX_COMMENTS) break;
          comments.push(reply);

          // Third level of depth
          if (
            maxDepth > 2 &&
            reply.kids &&
            reply.kids.length > 0 &&
            comments.length < MAX_COMMENTS
          ) {
            const deepReplyIds = reply.kids.slice(0, 3);
            const deepReplies = await this.fetchCommentBatch(deepReplyIds, 2);

            for (const deepReply of deepReplies) {
              if (comments.length >= MAX_COMMENTS) break;
              comments.push(deepReply);
            }
          }
        }
      }
    }

    return comments;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch items from the Firebase API in parallel batches and return
   * only valid (non-deleted, non-dead) comments with the assigned depth.
   */
  private async fetchCommentBatch(ids: number[], depth: number): Promise<HnComment[]> {
    const results: HnComment[] = [];

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const items = await Promise.all(batch.map((id) => this.fetchFirebaseItem(id)));

      for (const item of items) {
        if (!item || item.deleted || item.dead) continue;
        results.push({
          id: item.id,
          type: 'comment',
          by: item.by,
          time: item.time,
          text: item.text ?? '',
          parent: item.parent ?? 0,
          kids: item.kids,
          deleted: item.deleted,
          dead: item.dead,
          depth,
        });
      }
    }

    return results;
  }

  /**
   * Fetch a single item from Firebase, caching individually.
   */
  private async fetchFirebaseItem(id: number): Promise<FirebaseItem | null> {
    const cacheKey = `hn:item:${id}`;
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        try {
          const { data } = await firstValueFrom(
            this.http.get<FirebaseItem>(`${FIREBASE_BASE}/item/${id}.json`),
          );
          return data;
        } catch (err) {
          this.logger.warn(`Failed to fetch item ${id}: ${err}`);
          return null;
        }
      },
      TTL_COMMENT,
    );
  }

  /**
   * Build and execute an Algolia search request.
   */
  private async fetchAlgolia(
    endpoint: 'search' | 'search_by_date',
    query: string,
    options?: HnSearchOptions,
  ): Promise<HnSearchResult> {
    const hitsPerPage = Math.min(options?.hitsPerPage ?? 10, 20);
    const minPoints = options?.minPoints ?? 1;

    const params: Record<string, string> = {
      query,
      tags: 'story',
      numericFilters: `points>${minPoints}`,
      hitsPerPage: String(hitsPerPage),
    };

    const { data } = await firstValueFrom(
      this.http.get<HnSearchResult>(`${ALGOLIA_BASE}/${endpoint}`, { params }),
    );

    return data;
  }
}
