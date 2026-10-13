import { Module } from '@nestjs/common';

import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { QuotesModule } from '../quotes/quotes.module';
import { DocumentRecoveryService } from './document-recovery.service';

/** Reprise des PDF figés manquants (factures, reçus, devis envoyés), lancée par le worker. */
@Module({
  imports: [InvoicesModule, PaymentsModule, QuotesModule],
  providers: [DocumentRecoveryService],
  exports: [DocumentRecoveryService],
})
export class DocumentRecoveryModule {}
