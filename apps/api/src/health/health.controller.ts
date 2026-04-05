import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@voxpopuli/shared-types';
import { CacheService } from '../cache/cache.service';

/**
 * Exposes a lightweight health-check endpoint used by load balancers,
 * orchestrators, and the Angular client's status indicator.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly cache: CacheService) {}

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
}
