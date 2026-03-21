import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { GlobalExceptionFilter } from './errors/exception.filter';

async function bootstrap() {
  const config = new AppConfigService();

  const app = await NestFactory.create(AppModule, { cors: false });
  app.use(express.json({ limit: '1mb' }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableCors({ origin: config.corsOrigin, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false
    })
  );

  if (config.isDevelopment) {
    const swagger = new DocumentBuilder()
      .setTitle('MACP Scenario Registry')
      .setDescription('File-backed scenario catalog and compiler for the Multi-Agent Coordination Protocol')
      .setVersion('0.1.0')
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('docs', app, document);
  }

  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error(
    `bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
    err instanceof Error ? err.stack : undefined
  );
  process.exit(1);
});
