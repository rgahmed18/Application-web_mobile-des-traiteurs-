import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { QuotesModule } from '../quotes/quotes.module';
import { ClientAccountService } from './client-account.service';
import { ClientNoticesService } from './client-notices.service';
import { ClientRequestsService } from './client-requests.service';
import { ClientSiteController } from './client-site.controller';
import { ClientSpaceController } from './client-space.controller';
import { ClientSpaceService } from './client-space.service';

/** Espace des clients sur le site du traiteur, et avis qui leur sont envoyés. */
@Module({
  imports: [AuthModule, QuotesModule, InvoicesModule, PaymentsModule],
  controllers: [ClientSiteController, ClientSpaceController],
  providers: [
    ClientAccountService,
    ClientNoticesService,
    ClientRequestsService,
    ClientSpaceService,
  ],
  exports: [ClientNoticesService],
})
export class ClientSiteModule {}
