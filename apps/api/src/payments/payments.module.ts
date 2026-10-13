import { Module } from '@nestjs/common';

import { CashDeskController } from './cash-desk.controller';
import { CashDeskService } from './cash-desk.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** Encaissements, remboursements, reçus, échéancier et caisse livreurs. */
@Module({
  controllers: [PaymentsController, CashDeskController],
  providers: [PaymentsService, CashDeskService],
  exports: [CashDeskService],
})
export class PaymentsModule {}
