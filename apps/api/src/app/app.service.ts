import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@voxpopuli/shared-types';

@Injectable()
export class AppService {
  getData(): HealthResponse {
    return { status: 'ok', uptime: process.uptime() };
  }
}
