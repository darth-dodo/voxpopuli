import { Injectable } from '@nestjs/common';
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
 */
@Injectable()
export class QueryStore {
  constructor(private readonly cache: CacheService) {}

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
    this.cache.set(`dedup:${this.dedupKey(query, provider)}`, queryId, COMPLETED_TTL);
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
  }

  /**
   * Evidence from an earlier run, if it hasn't expired.
   *
   * @param queryId - The earlier query's identifier
   * @returns The stored evidence, or `undefined`
   */
  getEvidence(queryId: string): PriorEvidence | undefined {
    return this.cache.get<PriorEvidence>(`evidence:${queryId}`);
  }

  /**
   * Find a query whose result can be reused: one still running (attach to it) or
   * one that completed within {@link COMPLETED_TTL} (replay it). Failed queries are
   * never reused.
   *
   * @param query    - The user's query text
   * @param provider - The LLM provider name (callers include the pipeline mode)
   * @returns The queryId and whether it has already completed, or null
   */
  findReusable(query: string, provider: string): { queryId: string; complete: boolean } | null {
    const existingId = this.cache.get<string>(`dedup:${this.dedupKey(query, provider)}`);
    if (!existingId) return null;
    const entry = this.get(existingId);
    if (entry?.status === 'running') return { queryId: existingId, complete: false };
    if (entry?.status === 'complete' && entry.response) {
      return { queryId: existingId, complete: true };
    }
    return null;
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
