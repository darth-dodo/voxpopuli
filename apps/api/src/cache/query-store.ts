import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type {
  PriorEvidence,
  AgentResponse,
  AgentStep,
  StoredPipelineEvent,
  QueryResult,
} from '@voxpopuli/shared-types';
import { CacheService } from './cache.service';
import {
  KEY_VALUE_STORE,
  MemoryKeyValueStore,
  RedisKeyValueStore,
  type KeyValueStore,
} from './key-value-store';

/** TTL for query results: 5 minutes. */
const QUERY_TTL = 300;

/**
 * How long a completed answer is replayed to identical questions (15 min, matching
 * the HN search cache). Popular questions — e.g. the homepage examples — then cost
 * one pipeline run per window instead of one per visitor.
 */
const COMPLETED_TTL = 900;

/** How long a finished run's evidence stays available for follow-up questions. */
const EVIDENCE_TTL = 1800;

/**
 * Manages the lifecycle of query results, wrapping {@link CacheService}
 * to store agent results by queryId with create/get/complete/fail
 * lifecycle methods, event/step buffering, and query deduplication.
 *
 * Two layers (ADR-011):
 * - **Process-local** ({@link CacheService}, synchronous): the source of truth
 *   for this process — running entries with their buffered events/steps, which
 *   the SSE attach path polls. Running queries never leave this process.
 * - **Durable** ({@link KeyValueStore}, async, Redis when `REDIS_URL` is set):
 *   write-through copies of completed/failed results, a lightweight "running"
 *   marker, the dedup index and follow-up evidence, so replay, result lookup and
 *   follow-ups survive a restart. Reads fall back to it only on a local miss.
 *   Without `REDIS_URL` the durable layer is skipped and behavior is in-memory only.
 */
@Injectable()
export class QueryStore implements OnModuleDestroy {
  private readonly kv: KeyValueStore;

  constructor(
    private readonly cache: CacheService,
    @Optional() @Inject(KEY_VALUE_STORE) kv?: KeyValueStore,
  ) {
    this.kv = kv ?? new MemoryKeyValueStore(cache);
  }

  /** Close the Redis connection on shutdown. */
  async onModuleDestroy(): Promise<void> {
    if (this.kv instanceof RedisKeyValueStore) await this.kv.close();
  }

  /**
   * Create a new query entry. Returns the queryId (UUID v4).
   *
   * @param query    - The user's query text
   * @param provider - The LLM provider name
   * @returns A new UUID v4 queryId
   */
  create(query: string, provider: string): string {
    const queryId = randomUUID();
    const entry: QueryResult = {
      queryId,
      status: 'running',
      response: null,
      pipelineEvents: [],
      steps: [],
      error: null,
      createdAt: Date.now(),
      completedAt: null,
    };
    this.cache.set(`query:${queryId}`, entry, QUERY_TTL);
    // Dedup index: map query+provider hash to queryId (lives as long as a completed answer)
    const dedupKey = `dedup:${this.dedupKey(query, provider)}`;
    this.cache.set(dedupKey, queryId, COMPLETED_TTL);
    // Lightweight "running" marker (no events/steps) so another process — or this
    // one after a restart — can answer GET /query/:id/result with 202.
    this.persist(`query:${queryId}`, { ...entry, pipelineEvents: [], steps: [] }, QUERY_TTL);
    this.persist(dedupKey, queryId, COMPLETED_TTL);
    return queryId;
  }

  /**
   * Append a pipeline event to the stored result.
   *
   * @param queryId - The query identifier
   * @param event   - The pipeline event to append
   */
  appendEvent(queryId: string, event: StoredPipelineEvent): void {
    const entry = this.get(queryId);
    if (!entry) return;
    entry.pipelineEvents.push(event);
    this.cache.set(`query:${queryId}`, entry, QUERY_TTL);
  }

  /**
   * Append an agent step to the stored result.
   *
   * @param queryId - The query identifier
   * @param step    - The agent step to append
   */
  appendStep(queryId: string, step: AgentStep): void {
    const entry = this.get(queryId);
    if (!entry) return;
    entry.steps.push(step);
    this.cache.set(`query:${queryId}`, entry, QUERY_TTL);
  }

  /**
   * Mark query as complete with the final response.
   *
   * @param queryId  - The query identifier
   * @param response - The final agent response
   */
  complete(queryId: string, response: AgentResponse): void {
    const entry = this.get(queryId);
    if (!entry) return;
    entry.status = 'complete';
    entry.response = response;
    entry.completedAt = Date.now();
    this.cache.set(`query:${queryId}`, entry, COMPLETED_TTL);
    this.persist(`query:${queryId}`, entry, COMPLETED_TTL);
  }

  /**
   * Mark query as failed with error message.
   *
   * @param queryId - The query identifier
   * @param error   - The error message
   */
  fail(queryId: string, error: string): void {
    const entry = this.get(queryId);
    if (!entry) return;
    entry.status = 'error';
    entry.error = error;
    entry.completedAt = Date.now();
    this.cache.set(`query:${queryId}`, entry, QUERY_TTL);
    this.persist(`query:${queryId}`, entry, QUERY_TTL);
  }

  /**
   * Retrieve a stored query result by ID.
   *
   * @param queryId - The query identifier
   * @returns The stored query result, or `undefined` if not found
   */
  get(queryId: string): QueryResult | undefined {
    return this.cache.get<QueryResult>(`query:${queryId}`);
  }

  /**
   * Look up a query result in this process, then in the durable store (e.g. a
   * result completed before a restart). A durable-only running entry is a marker
   * without events or steps.
   *
   * @param queryId - The query identifier
   * @returns The stored query result, or `undefined` if not found or expired
   */
  async findResult(queryId: string): Promise<QueryResult | undefined> {
    const local = this.get(queryId);
    if (local || !this.kv.durable) return local;
    return this.kv.get<QueryResult>(`query:${queryId}`);
  }

  /**
   * Check if an identical query is already running.
   * Returns the existing queryId or null.
   *
   * @param query    - The user's query text
   * @param provider - The LLM provider name
   * @returns The existing queryId if still running, or null
   */
  findRunning(query: string, provider: string): string | null {
    const existingId = this.cache.get<string>(`dedup:${this.dedupKey(query, provider)}`);
    if (!existingId) return null;
    const entry = this.get(existingId);
    // Only return if the query is still running
    if (entry && entry.status === 'running') return existingId;
    return null;
  }

  /**
   * Keep a completed run's evidence so follow-up questions can reuse it.
   *
   * @param queryId  - The completed query's identifier
   * @param evidence - Bundle, retriever steps and the original question
   */
  setEvidence(queryId: string, evidence: PriorEvidence): void {
    this.cache.set(`evidence:${queryId}`, evidence, EVIDENCE_TTL);
    this.persist(`evidence:${queryId}`, evidence, EVIDENCE_TTL);
  }

  /**
   * Evidence from an earlier run, if it hasn't expired.
   *
   * @param queryId - The earlier query's identifier
   * @returns The stored evidence, or `undefined`
   */
  async getEvidence(queryId: string): Promise<PriorEvidence | undefined> {
    const local = this.cache.get<PriorEvidence>(`evidence:${queryId}`);
    if (local || !this.kv.durable) return local;
    return this.kv.get<PriorEvidence>(`evidence:${queryId}`);
  }

  /**
   * Find a query whose result can be reused: one still running (attach to it) or
   * one that completed within {@link COMPLETED_TTL} (replay it). Failed queries are
   * never reused.
   *
   * On a local miss the durable store is consulted: a completed answer found there
   * (e.g. from before a restart) is copied into this process so the SSE replay path
   * can read it. A query running in another process cannot be attached to — its
   * events live in that process — so it is not reused.
   *
   * @param query    - The user's query text
   * @param provider - The LLM provider name (callers include the pipeline mode)
   * @returns The queryId and whether it has already completed, or null
   */
  async findReusable(
    query: string,
    provider: string,
  ): Promise<{ queryId: string; complete: boolean } | null> {
    const dedupKey = `dedup:${this.dedupKey(query, provider)}`;
    const existingId = this.cache.get<string>(dedupKey);
    if (existingId) {
      const entry = this.get(existingId);
      if (entry?.status === 'running') return { queryId: existingId, complete: false };
      if (entry?.status === 'complete' && entry.response) {
        return { queryId: existingId, complete: true };
      }
      return null;
    }
    if (!this.kv.durable) return null;

    const durableId = await this.kv.get<string>(dedupKey);
    if (!durableId) return null;
    const entry = await this.kv.get<QueryResult>(`query:${durableId}`);
    if (entry?.status !== 'complete' || !entry.response) return null;
    // Hydrate locally just long enough for the replay to read it.
    this.cache.set(`query:${durableId}`, entry, QUERY_TTL);
    return { queryId: durableId, complete: true };
  }

  /** Write-through to the durable store; a no-op when it is in-memory. */
  private persist<T>(key: string, value: T, ttlSeconds: number): void {
    if (!this.kv.durable) return;
    // KeyValueStore implementations swallow and log their own errors.
    void this.kv.set(key, value, ttlSeconds);
  }

  /**
   * Generate a dedup key from query text + provider. Case and whitespace are
   * normalized so trivially different phrasings share a result.
   *
   * @param query    - The user's query text
   * @param provider - The LLM provider name
   * @returns A truncated SHA-256 hash
   */
  private dedupKey(query: string, provider: string): string {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
    return createHash('sha256').update(`${normalized}:${provider}`).digest('hex').slice(0, 16);
  }
}
