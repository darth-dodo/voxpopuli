import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validate } from '../config/env.validation';
import { HealthModule } from '../health/health.module';
import { CacheModule } from '../cache/cache.module';
import { HnModule } from '../hn/hn.module';
import { ChunkerModule } from '../chunker/chunker.module';
import { LlmModule } from '../llm/llm.module';
import { AgentModule } from '../agent/agent.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        ...(process.env.NODE_ENV !== 'production'
          ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
          : {}),
        level: process.env.LOG_LEVEL || 'info',
        genReqId: (req: { headers: Record<string, string | string[] | undefined> }) =>
          (req.headers['x-request-id'] as string) || crypto.randomUUID(),
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'req.query.api_key'],
          remove: true,
        },
        serializers: {
          req: (req: { method: string; url: string; query: unknown; remotePort: number }) => ({
            method: req.method,
            url: req.url,
            query: req.query,
            remotePort: req.remotePort,
          }),
        },
      } as Record<string, unknown>,
    }),
    CacheModule,
    HealthModule,
    HnModule,
    ChunkerModule,
    LlmModule,
    AgentModule,
    RagModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
