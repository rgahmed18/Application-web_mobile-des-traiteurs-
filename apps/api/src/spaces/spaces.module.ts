import { Global, Module } from '@nestjs/common';

import { PublicSpacesController } from './public-spaces.controller';
import { SpacesService } from './spaces.service';

/** Espaces (console, back-office de chaque traiteur) servis selon l'adresse. */
@Global()
@Module({
  controllers: [PublicSpacesController],
  providers: [SpacesService],
  exports: [SpacesService],
})
export class SpacesModule {}
