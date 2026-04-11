import {
  Controller,
  Post,
  Body,
  Query,
  Sse,
  Header,
  Logger,
  HttpException,
  HttpStatus,
  MessageEvent,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AgentResponse } from '@voxpopuli/shared-types';
import { PipelineConfigSchema } from '@voxpopuli/shared-types';
import { AgentService } from '../agent/agent.service';
import { OrchestratorService } from '../agent/orchestrator.service';
import { CacheService } from '../cache/cache.service';
import { RagQueryDto } from './dto/rag-query.dto';

/** Cache TTL for query results (10 minutes). */
const CACHE_TTL = 600;

/** SSE heartbeat interval in milliseconds (15 seconds). */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** SSE retry directive in milliseconds (5 seconds). */
const SSE_RETRY_MS = 5_000;

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

  constructor(
    private readonly agent: AgentService,
    private readonly orchestrator: OrchestratorService,
    private readonly cache: CacheService,
  ) {}

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
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  stream(
    @Query('query') query: string,
    @Query('provider') provider?: string,
    @Query('useMultiAgent') useMultiAgent?: string,
  ): Observable<MessageEvent> {
    if (!query || query.length > 500) {
      throw new HttpException(
        'Query is required and must be 500 characters or less',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.enforceRateLimit();

    if (useMultiAgent === 'true') {
      return this.streamMultiAgent(query, provider);
    }

    return this.streamLegacy(query, provider);
  }

  /**
   * Legacy streaming path — delegates to AgentService.runStream().
   *
   * Emits SSE events with incrementing `id` fields for reconnection support,
   * a `retry` directive on the first event, and periodic heartbeat comments
   * to keep the connection alive on mobile browsers.
   */
  private streamLegacy(query: string, provider?: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let eventId = 0;
      let cancelled = false;

      const heartbeatInterval = setInterval(() => {
        if (!cancelled) {
          subscriber.next({ type: 'heartbeat', data: '' } as MessageEvent);
        }
      }, HEARTBEAT_INTERVAL_MS);

      const emit = (event: Partial<MessageEvent>, isFirst = false): void => {
        const msg: MessageEvent = {
          ...event,
          id: String(++eventId),
        } as MessageEvent;
        if (isFirst) {
          (msg as unknown as { retry: number }).retry = SSE_RETRY_MS;
        }
        subscriber.next(msg);
      };

      const generator = this.agent.runStream(query, { provider });

      (async () => {
        let isFirst = true;
        try {
          for await (const event of generator) {
            if (cancelled) break;

            if (event.kind === 'step') {
              emit(
                {
                  type: event.step.type,
                  data: JSON.stringify({
                    content: event.step.content,
                    toolName: event.step.toolName,
                    toolInput: event.step.toolInput,
                    timestamp: event.step.timestamp,
                  }),
                },
                isFirst,
              );
              isFirst = false;
            } else if (event.kind === 'complete') {
              emit(
                {
                  type: 'answer',
                  data: JSON.stringify({
                    answer: event.response.answer,
                    sources: event.response.sources,
                    trust: event.response.trust,
                    meta: event.response.meta,
                  }),
                },
                isFirst,
              );
              isFirst = false;
            }
          }
          subscriber.complete();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Stream error: ${message}`, err instanceof Error ? err.stack : '');
          emit(
            {
              type: 'error',
              data: JSON.stringify({ message }),
            },
            isFirst,
          );
          subscriber.complete();
        } finally {
          clearInterval(heartbeatInterval);
        }
      })();

      return () => {
        cancelled = true;
        clearInterval(heartbeatInterval);
      };
    });
  }

  /**
   * Multi-agent pipeline streaming path — delegates to OrchestratorService.runWithFallback().
   *
   * Maps pipeline events to SSE types:
   * - `kind: 'pipeline'` → SSE type `pipeline`
   * - `kind: 'step'`     → SSE type matching `step.type` (thought/action/observation)
   * - `kind: 'token'`    → SSE type `token`
   * - `kind: 'complete'` → SSE type `answer`
   *
   * Emits SSE events with incrementing `id` fields for reconnection support,
   * a `retry` directive on the first event, and periodic heartbeat comments
   * to keep the connection alive on mobile browsers.
   */
  private streamMultiAgent(query: string, provider?: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let eventId = 0;
      let cancelled = false;

      const heartbeatInterval = setInterval(() => {
        if (!cancelled) {
          subscriber.next({ type: 'heartbeat', data: '' } as MessageEvent);
        }
      }, HEARTBEAT_INTERVAL_MS);

      const emit = (event: Partial<MessageEvent>, isFirst = false): void => {
        const msg: MessageEvent = {
          ...event,
          id: String(++eventId),
        } as MessageEvent;
        if (isFirst) {
          (msg as unknown as { retry: number }).retry = SSE_RETRY_MS;
        }
        subscriber.next(msg);
      };

      const parsed = PipelineConfigSchema.safeParse({
        providerMap: provider
          ? { retriever: provider, synthesizer: provider, writer: provider }
          : undefined,
      });
      const config = parsed.success ? parsed.data : PipelineConfigSchema.parse({});

      const generator = this.orchestrator.runWithFallback(query, config);

      (async () => {
        let isFirst = true;
        try {
          for await (const event of generator) {
            if (cancelled) break;

            if (event.kind === 'pipeline') {
              emit(
                {
                  type: 'pipeline',
                  data: JSON.stringify(event.event),
                },
                isFirst,
              );
              isFirst = false;
            } else if (event.kind === 'step') {
              emit(
                {
                  type: event.step.type,
                  data: JSON.stringify({
                    content: event.step.content,
                    toolName: event.step.toolName,
                    toolInput: event.step.toolInput,
                    timestamp: event.step.timestamp,
                  }),
                },
                isFirst,
              );
              isFirst = false;
            } else if (event.kind === 'token') {
              emit(
                {
                  type: 'token',
                  data: JSON.stringify({ content: event.content }),
                },
                isFirst,
              );
              isFirst = false;
            } else if (event.kind === 'complete') {
              emit(
                {
                  type: 'answer',
                  data: JSON.stringify({
                    answer: event.response.answer,
                    sources: event.response.sources,
                    trust: event.response.trust,
                    meta: event.response.meta,
                  }),
                },
                isFirst,
              );
              isFirst = false;
            }
          }
          subscriber.complete();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Multi-agent stream error: ${message}`,
            err instanceof Error ? err.stack : '',
          );
          emit(
            {
              type: 'error',
              data: JSON.stringify({ message }),
            },
            isFirst,
          );
          subscriber.complete();
        } finally {
          clearInterval(heartbeatInterval);
        }
      })();

      return () => {
        cancelled = true;
        clearInterval(heartbeatInterval);
      };
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
