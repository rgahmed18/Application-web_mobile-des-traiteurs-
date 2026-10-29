import { Module } from '@nestjs/common';

import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';

/** Brouillons des formulaires du back-office (côté serveur). */
@Module({
  controllers: [DraftsController],
  providers: [DraftsService],
  exports: [DraftsService],
})
export class DraftsModule {}
