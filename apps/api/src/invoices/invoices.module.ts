import { Module } from '@nestjs/common';

import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

/** Factures et avoirs : émission, PDF figé, liste et export comptable. */
@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
