import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

/**
 * Point d'entrée du processus worker (`node dist/worker`) : même code que l'API, aucun serveur
 * HTTP. Il exécute les tâches BullMQ (reprise des PDF, nettoyage des photos, expiration des
 * devis). Plusieurs workers peuvent tourner : BullMQ distribue chaque tâche à un seul d'entre eux.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('Worker démarré (tâches BullMQ)', 'Bootstrap');
}

void bootstrap();
