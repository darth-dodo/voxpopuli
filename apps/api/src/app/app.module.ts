import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validate } from '../config/env.validation';
import { HealthModule } from '../health/health.module';
import { CacheModule } from '../cache/cache.module';
import { HnModule } from '../hn/hn.module';
import { ChunkerModule } from '../chunker/chunker.module';
import { LlmModule } from '../llm/llm.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [
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
      } as Record<string, unknown>,
    }),
    CacheModule,
    HealthModule,
    HnModule,
    ChunkerModule,
    LlmModule,
    RagModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
