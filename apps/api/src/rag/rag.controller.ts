import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Res,
  Sse,
  Header,
  Logger,
  HttpException,
  HttpStatus,
  MessageEvent,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import type {
  AgentResponse,
  QueryResult,
  StoredPipelineEvent,
  AgentStep,
} from '@voxpopuli/shared-types';
import { PipelineConfigSchema } from '@voxpopuli/shared-types';
import { AgentService } from '../agent/agent.service';
import { OrchestratorService } from '../agent/orchestrator.service';
import { CacheService } from '../cache/cache.service';
import { QueryStore } from '../cache/query-store';
import { RagQueryDto } from './dto/rag-query.dto';

/** Cache TTL for query results (10 minutes). */
const CACHE_TTL = 600;

/** SSE heartbeat interval in milliseconds (10 seconds). */
const HEARTBEAT_INTERVAL_MS = 10_000;

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
    private readonly queryStore: QueryStore,
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

    const cacheKey = `rag:query:${dto.query}:${dto.useMultiAgent ?? false}`;

    if (dto.useMultiAgent) {
      return this.cache.getOrSet(
        cacheKey,
        () => this.runPipeline(dto.query, dto.provider),
        CACHE_TTL,
      );
    }

    return this.cache.getOrSet(
      cacheKey,
      () => this.agent.run(dto.query, { maxSteps: dto.maxSteps, provider: dto.provider }),
      CACHE_TTL,
    );
  }

  /**
   * Run the multi-agent pipeline and collect the final AgentResponse.
   */
  private async runPipeline(query: string, provider?: string): Promise<AgentResponse> {
    const parsed = PipelineConfigSchema.safeParse({
      providerMap: provider
        ? { retriever: provider, synthesizer: provider, writer: provider }
        : undefined,
    });
    const config = parsed.success ? parsed.data : PipelineConfigSchema.parse({});

    for await (const event of this.orchestrator.runWithFallback(query, config)) {
      if (event.kind === 'complete') {
        return event.response;
      }
    }

    throw new HttpException(
      'Pipeline completed without a response',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  /**
   * Retrieve a stored query result by ID.
   *
   * Returns 200 with full {@link QueryResult} when complete or errored,
   * 202 with partial data when still running, or 404 if not found/expired.
   *
   * @param queryId - The UUID returned by the SSE `init` event
   */
  @Get('query/:id/result')
  getResult(@Param('id') queryId: string, @Res() res: Response): void {
    const result = this.queryStore.get(queryId);
    if (!result) {
      throw new HttpException('Query not found or expired', HttpStatus.NOT_FOUND);
    }
    if (result.status === 'running') {
      res.status(HttpStatus.ACCEPTED).json({
        status: 'running',
        queryId: result.queryId,
        pipelineEvents: result.pipelineEvents,
        steps: result.steps,
      });
      return;
    }
    res.status(HttpStatus.OK).json(result);
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
   * a `retry` directive on the first event, and periodic `ping` events
   * to keep the connection alive on mobile browsers and enable client-side
   * stall detection.
   */
  private streamLegacy(query: string, provider?: string): Observable<MessageEvent> {
    // Check for duplicate in-flight query
    const existingId = this.queryStore.findRunning(query, provider ?? 'default');
    if (existingId) {
      return this.pollExistingQuery(existingId);
    }

    return new Observable<MessageEvent>((subscriber) => {
      let eventId = 0;
      let cancelled = false;

      const heartbeatInterval = setInterval(() => {
        if (!cancelled) {
          subscriber.next({ type: 'ping', data: '', id: String(++eventId) } as MessageEvent);
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

      const queryId = this.queryStore.create(query, provider ?? 'default');
      const generator = this.agent.runStream(query, { provider });

      (async () => {
        let isFirst = true;

        // Emit init event with queryId as the very first SSE event
        emit({ type: 'init', data: JSON.stringify({ queryId }) }, true);
        isFirst = false;

        try {
          for await (const event of generator) {
            if (cancelled) break;

            if (event.kind === 'step') {
              const stepData: AgentStep = {
                type: event.step.type,
                content: event.step.content,
                toolName: event.step.toolName,
                toolInput: event.step.toolInput,
                timestamp: event.step.timestamp,
              };
              this.queryStore.appendStep(queryId, stepData);
              emit(
                {
                  type: event.step.type,
                  data: JSON.stringify(stepData),
                },
                isFirst,
              );
              isFirst = false;
            } else if (event.kind === 'complete') {
              this.queryStore.complete(queryId, event.response);
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
          this.queryStore.fail(queryId, message);
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
   * a `retry` directive on the first event, and periodic `ping` events
   * to keep the connection alive on mobile browsers and enable client-side
   * stall detection.
   */
  private streamMultiAgent(query: string, provider?: string): Observable<MessageEvent> {
    // Check for duplicate in-flight query
    const existingId = this.queryStore.findRunning(query, provider ?? 'default');
    if (existingId) {
      return this.pollExistingQuery(existingId);
    }

    return new Observable<MessageEvent>((subscriber) => {
      let eventId = 0;
      let cancelled = false;

      const heartbeatInterval = setInterval(() => {
        if (!cancelled) {
          subscriber.next({ type: 'ping', data: '', id: String(++eventId) } as MessageEvent);
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

      const queryId = this.queryStore.create(query, provider ?? 'default');
      const generator = this.orchestrator.runWithFallback(query, config);

      (async () => {
        let isFirst = true;

        // Emit init event with queryId as the very first SSE event
        emit({ type: 'init', data: JSON.stringify({ queryId }) }, true);
        isFirst = false;

        try {
          for await (const event of generator) {
            if (cancelled) break;

            if (event.kind === 'pipeline') {
              this.queryStore.appendEvent(queryId, event.event as StoredPipelineEvent);
              emit(
                {
                  type: 'pipeline',
                  data: JSON.stringify(event.event),
                },
                isFirst,
              );
              isFirst = false;
            } else if (event.kind === 'step') {
              const stepData: AgentStep = {
                type: event.step.type,
                content: event.step.content,
                toolName: event.step.toolName,
                toolInput: event.step.toolInput,
                timestamp: event.step.timestamp,
              };
              this.queryStore.appendStep(queryId, stepData);
              emit(
                {
                  type: event.step.type,
                  data: JSON.stringify(stepData),
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
              this.queryStore.complete(queryId, event.response);
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
          this.queryStore.fail(queryId, message);
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
   * Poll an existing in-flight query instead of starting a duplicate agent run.
   *
   * Returns an Observable that emits SSE events by polling the QueryStore
   * every 2 seconds for new pipeline events, steps, and completion status.
   *
   * @param queryId - The existing query's ID from QueryStore.findRunning()
   * @returns Observable of SSE {@link MessageEvent}s
   */
  private pollExistingQuery(queryId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let eventId = 0;
      let lastEventCount = 0;
      let lastStepCount = 0;

      const emit = (event: Partial<MessageEvent>): void => {
        subscriber.next({ ...event, id: String(++eventId) } as MessageEvent);
      };

      // Emit init with queryId
      emit({ type: 'init', data: JSON.stringify({ queryId }) });

      const interval = setInterval(() => {
        const result = this.queryStore.get(queryId);
        if (!result) {
          emit({ type: 'error', data: JSON.stringify({ message: 'Query expired' }) });
          clearInterval(interval);
          clearInterval(heartbeat);
          subscriber.complete();
          return;
        }

        // Emit any new pipeline events
        while (lastEventCount < result.pipelineEvents.length) {
          emit({
            type: 'pipeline',
            data: JSON.stringify(result.pipelineEvents[lastEventCount]),
          });
          lastEventCount++;
        }

        // Emit any new steps
        while (lastStepCount < result.steps.length) {
          const step = result.steps[lastStepCount];
          emit({ type: step.type, data: JSON.stringify(step) });
          lastStepCount++;
        }

        if (result.status === 'complete' && result.response) {
          emit({
            type: 'answer',
            data: JSON.stringify({
              answer: result.response.answer,
              sources: result.response.sources,
              trust: result.response.trust,
              meta: result.response.meta,
            }),
          });
          clearInterval(interval);
          clearInterval(heartbeat);
          subscriber.complete();
        } else if (result.status === 'error') {
          emit({ type: 'error', data: JSON.stringify({ message: result.error }) });
          clearInterval(interval);
          clearInterval(heartbeat);
          subscriber.complete();
        }
      }, 2000);

      // Heartbeat
      const heartbeat = setInterval(() => {
        emit({ type: 'ping', data: '' });
      }, HEARTBEAT_INTERVAL_MS);

      return () => {
        clearInterval(interval);
        clearInterval(heartbeat);
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
