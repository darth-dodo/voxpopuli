import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // AI-141: Use structured Pino logger
  app.useLogger(app.get(PinoLogger));

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  // AI-156: Configure CORS for Angular dev server
  app.enableCors({ origin: 'http://localhost:4200' });

  // AI-142: Enable graceful shutdown hooks
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
