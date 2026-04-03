import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as http from 'http';
import { HealthModule } from './health.module';
import type { HealthResponse } from '@voxpopuli/shared-types';

/**
 * Helper that performs a GET request against the test application and returns
 * the parsed JSON body along with the HTTP status code.
 */
function get(app: INestApplication, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    if (!address || typeof address === 'string') {
      return reject(new Error('Server address unavailable'));
    }
    const req = http.request(
      { hostname: '127.0.0.1', port: address.port, path, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('HealthController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    await app.listen(0); // random available port
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns 200 with correct response shape', async () => {
    const { status, body } = await get(app, '/api/health');

    expect(status).toBe(200);

    const health = body as HealthResponse;
    expect(health.status).toBe('ok');
    expect(typeof health.uptime).toBe('number');
    expect(health.uptime).toBeGreaterThan(0);

    expect(health.cacheStats).toBeDefined();
    expect(health.cacheStats.hits).toBe(0);
    expect(health.cacheStats.misses).toBe(0);
    expect(health.cacheStats.keys).toBe(0);
  });
});
