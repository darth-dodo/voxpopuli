import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HealthResponse, LlmHealthResponse } from '@voxpopuli/shared-types';
import { CacheService } from '../cache/cache.service';
import { LlmService } from '../llm/llm.service';
import { isAuthError } from '../llm/llm-errors';

/** Cache the live LLM probe so the endpoint can't be used to run up provider costs. */
const LLM_CHECK_TTL_SECONDS = 60;

/** Give up on a hung provider rather than holding the request open. */
const LLM_CHECK_TIMEOUT_MS = 15_000;

/**
 * Exposes a lightweight health-check endpoint used by load balancers,
 * orchestrators, and the Angular client's status indicator.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly cache: CacheService, private readonly llm: LlmService) {}

  /**
   * Returns current API health status including uptime, cache statistics,
   * and heap memory usage.
   *
   * @returns Health payload with uptime in seconds, cache stats, and memory.
   */
  @Get()
  getHealth(): HealthResponse & { memoryMB: number } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      cacheStats: this.cache.getStats(),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }

  /**
   * Deep check: makes a tiny real call to the active LLM provider, so a missing or
   * rejected API key shows up here instead of as failed user queries. Opt-in (not
   * the platform health check) and cached for 60s.
   *
   * @returns 200 with `ok: true`, or 503 with the failure classified.
   */
  @Get('llm')
  async getLlmHealth(@Res({ passthrough: true }) res: Response): Promise<LlmHealthResponse> {
    const result = await this.cache.getOrSet(
      'health:llm',
      () => this.probeLlm(),
      LLM_CHECK_TTL_SECONDS,
    );
    // Set the status directly: the global exception filter would replace this body.
    if (!result.ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }

  private async probeLlm(): Promise<LlmHealthResponse> {
    const provider = this.llm.getProviderName();
    const start = Date.now();
    try {
      const model = this.llm.getModel(undefined, { maxTokens: 5 });
      await model.invoke('Reply with OK.', { signal: AbortSignal.timeout(LLM_CHECK_TIMEOUT_MS) });
      return { provider, ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        provider,
        ok: false,
        latencyMs: Date.now() - start,
        error: isAuthError(err) ? 'auth' : 'unavailable',
        detail: message.split('\n')[0].slice(0, 200),
      };
    }
  }
}
