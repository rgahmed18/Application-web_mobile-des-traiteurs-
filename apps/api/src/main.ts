import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { z } from 'zod';

import { AppModule } from './app.module';
import type { AppConfigService } from './config/app-config.module';

// Messages de validation en français (les codes d'erreur restent stables pour les clients)
z.config(z.locales.fr());

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config: AppConfigService = app.get(ConfigService);

  // Derrière un reverse proxy, request.ip doit refléter l'IP réelle du client
  if (config.get('TRUST_PROXY', { infer: true })) app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Gestion Traiteurs API')
        .setDescription('API de la plateforme multi-traiteurs')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API démarrée sur http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
