jest.mock('../llm/providers/openrouter.provider', () => ({ OpenRouterProvider: jest.fn() }));
jest.mock('../llm/providers/claude.provider', () => ({ ClaudeProvider: jest.fn() }));
jest.mock('../llm/providers/mistral.provider', () => ({ MistralProvider: jest.fn() }));

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as http from 'http';
import { HealthModule } from './health.module';
import { CacheModule } from '../cache/cache.module';
import { CacheService } from '../cache/cache.service';
import { LlmService } from '../llm/llm.service';
import type { HealthResponse, LlmHealthResponse } from '@voxpopuli/shared-types';

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
  const invoke = jest.fn();
  const mockLlm = {
    getProviderName: jest.fn(() => 'mistral'),
    getModel: jest.fn(() => ({ invoke })),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [HealthModule, CacheModule],
    })
      .overrideProvider(LlmService)
      .useValue(mockLlm)
      .compile();

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
    expect(typeof health.cacheStats.hits).toBe('number');
    expect(typeof health.cacheStats.misses).toBe('number');
    expect(typeof health.cacheStats.keys).toBe('number');

    const extended = body as HealthResponse & { memoryMB: number };
    expect(typeof extended.memoryMB).toBe('number');
    expect(extended.memoryMB).toBeGreaterThan(0);
  });

  describe('GET /api/health/llm', () => {
    beforeEach(() => {
      invoke.mockReset();
      app.get(CacheService).del('health:llm');
    });

    it('returns 200 when the provider answers', async () => {
      invoke.mockResolvedValue({ content: 'OK' });

      const { status, body } = await get(app, '/api/health/llm');

      expect(status).toBe(200);
      expect(body).toMatchObject({ provider: 'mistral', ok: true });
      expect(mockLlm.getModel).toHaveBeenCalledWith(undefined, { maxTokens: 5 });
    });

    it('returns 503 classified as auth when the key is rejected', async () => {
      invoke.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));

      const { status, body } = await get(app, '/api/health/llm');

      expect(status).toBe(503);
      expect(body as LlmHealthResponse).toMatchObject({ ok: false, error: 'auth' });
    });

    it('caches the probe so repeated checks do not call the provider again', async () => {
      invoke.mockResolvedValue({ content: 'OK' });

      await get(app, '/api/health/llm');
      await get(app, '/api/health/llm');

      expect(invoke).toHaveBeenCalledTimes(1);
    });
  });
});
