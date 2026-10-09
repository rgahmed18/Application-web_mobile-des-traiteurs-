import { Module } from '@nestjs/common';

import { BillingSettingsController } from './billing-settings.controller';
import { BillingSettingsService } from './billing-settings.service';

/** Paramètres du traiteur (pour l'instant : documents et paiements). */
@Module({
  controllers: [BillingSettingsController],
  providers: [BillingSettingsService],
})
export class SettingsModule {}
