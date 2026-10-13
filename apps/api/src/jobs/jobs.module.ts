import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { DocumentRecoveryModule } from '../document-recovery/document-recovery.module';
import { QuotesModule } from '../quotes/quotes.module';
import { DOCUMENTS_QUEUE, DocumentRecoveryProcessor } from './document-recovery.processor';
import { MEDIA_QUEUE, MediaCleanupProcessor } from './media-cleanup.processor';
import { QUOTES_QUEUE, QuoteExpiryProcessor } from './quote-expiry.processor';

/**
 * Tâches BullMQ (planifiées) : reprise des PDF manquants, nettoyage des photos orphelines,
 * expiration des devis. Chargé UNIQUEMENT par le processus worker (src/worker.ts) : l'API ne
 * consomme aucune file, elle reste réactive quoi qu'il arrive aux traitements de fond.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: DOCUMENTS_QUEUE },
      { name: MEDIA_QUEUE },
      { name: QUOTES_QUEUE },
    ),
    CatalogModule,
    DocumentRecoveryModule,
    QuotesModule,
  ],
  providers: [DocumentRecoveryProcessor, MediaCleanupProcessor, QuoteExpiryProcessor],
})
export class JobsModule {}
