import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ClientAccountService } from './client-account.service';
import { ClientNoticesService } from './client-notices.service';
import { ClientSiteController } from './client-site.controller';

/** Espace des clients sur le site du traiteur, et avis qui leur sont envoyés. */
@Module({
  imports: [AuthModule],
  controllers: [ClientSiteController],
  providers: [ClientAccountService, ClientNoticesService],
  exports: [ClientNoticesService],
})
export class ClientSiteModule {}
