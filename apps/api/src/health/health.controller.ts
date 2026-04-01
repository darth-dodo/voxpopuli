import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@voxpopuli/shared-types';

/**
 * Exposes a lightweight health-check endpoint used by load balancers,
 * orchestrators, and the Angular client's status indicator.
 */
@Controller('health')
export class HealthController {
  /**
   * Returns current API health status including uptime and cache statistics.
   *
   * @returns {HealthResponse} Health payload with uptime in seconds and cache stats.
   */
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
      cacheStats: {
        hits: 0,
        misses: 0,
        keys: 0,
      },
    };
  }
}
