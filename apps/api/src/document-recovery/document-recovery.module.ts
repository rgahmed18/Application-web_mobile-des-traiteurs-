import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { QuotesModule } from '../quotes/quotes.module';
import { DOCUMENTS_QUEUE, DocumentRecoveryProcessor } from './document-recovery.processor';
import { DocumentRecoveryService } from './document-recovery.service';

/** Reprise automatique des PDF figés manquants (factures, reçus, devis envoyés). */
@Module({
  imports: [
    BullModule.registerQueue({ name: DOCUMENTS_QUEUE }),
    InvoicesModule,
    PaymentsModule,
    QuotesModule,
  ],
  providers: [DocumentRecoveryService, DocumentRecoveryProcessor],
  exports: [DocumentRecoveryService],
})
export class DocumentRecoveryModule {}
