import { Module } from '@nestjs/common';

import { ClientSiteModule } from '../client-site/client-site.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

/** Clients du traiteur (coordonnées propres au traiteur, adresses, historique). */
@Module({
  imports: [ClientSiteModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
