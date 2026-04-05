import {
  Controller,
  Post,
  Body,
  Query,
  Sse,
  Logger,
  HttpException,
  HttpStatus,
  MessageEvent,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AgentResponse } from '@voxpopuli/shared-types';
import { AgentService } from '../agent/agent.service';
import { CacheService } from '../cache/cache.service';
import { RagQueryDto } from './dto/rag-query.dto';

/** Cache TTL for query results (10 minutes). */
const CACHE_TTL = 600;

/** Global rate limit: max requests per minute. */
const RATE_LIMIT = 60;

/** Rate limit window in milliseconds. */
const RATE_WINDOW_MS = 60_000;

/**
 * Controller for the VoxPopuli RAG endpoints.
 *
 * Provides a blocking POST endpoint for full agent responses and an
 * SSE GET endpoint for streaming intermediate agent steps.
 */
@Controller('rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);

  /** Simple global rate limiter — timestamps of recent requests. */
  private readonly requestTimestamps: number[] = [];

  constructor(private readonly agent: AgentService, private readonly cache: CacheService) {}

  /**
   * Execute a RAG query and return the full agent response.
   *
   * Results are cached for 10 minutes keyed by query string.
   *
   * @param dto - Validated query parameters
   * @returns Complete {@link AgentResponse}
   */
  @Post('query')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async query(@Body() dto: RagQueryDto): Promise<AgentResponse> {
    this.enforceRateLimit();

    const cacheKey = `rag:query:${dto.query}`;
    return this.cache.getOrSet(
      cacheKey,
      () => this.agent.run(dto.query, { maxSteps: dto.maxSteps, provider: dto.provider }),
      CACHE_TTL,
    );
  }

  /**
   * Stream a RAG query as Server-Sent Events.
   *
   * Events are emitted in real time as the agent loop progresses — each
   * thought, action, and observation is sent to the client as it occurs,
   * followed by a final `answer` event when the loop completes.
   *
   * @param query - The search query (required, max 500 chars)
   * @returns Observable of SSE {@link MessageEvent}s
   */
  @Sse('stream')
  stream(@Query('query') query: string): Observable<MessageEvent> {
    if (!query || query.length > 500) {
      throw new HttpException(
        'Query is required and must be 500 characters or less',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.enforceRateLimit();

    return new Observable<MessageEvent>((subscriber) => {
      const generator = this.agent.runStream(query);

      (async () => {
        try {
          for await (const event of generator) {
            if (event.kind === 'step') {
              subscriber.next({
                type: event.step.type,
                data: JSON.stringify({
                  content: event.step.content,
                  toolName: event.step.toolName,
                  toolInput: event.step.toolInput,
                  timestamp: event.step.timestamp,
                }),
              } as MessageEvent);
            } else if (event.kind === 'complete') {
              subscriber.next({
                type: 'answer',
                data: JSON.stringify({
                  answer: event.response.answer,
                  sources: event.response.sources,
                  trust: event.response.trust,
                  meta: event.response.meta,
                }),
              } as MessageEvent);
            }
          }
          subscriber.complete();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Stream error: ${message}`, err instanceof Error ? err.stack : '');
          subscriber.next({
            type: 'error',
            data: JSON.stringify({ message }),
          } as MessageEvent);
          subscriber.complete();
        }
      })();
    });
  }

  /**
   * Enforce the global rate limit.
   * Prunes old timestamps and throws 429 if the limit is exceeded.
   */
  private enforceRateLimit(): void {
    const now = Date.now();

    // Prune timestamps older than the window
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < now - RATE_WINDOW_MS) {
      this.requestTimestamps.shift();
    }

    if (this.requestTimestamps.length >= RATE_LIMIT) {
      throw new HttpException(
        'Rate limit exceeded. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.requestTimestamps.push(now);
  }
}
