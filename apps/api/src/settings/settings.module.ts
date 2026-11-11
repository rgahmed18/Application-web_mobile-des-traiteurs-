import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AccountService } from './account.service';
import { BillingSettingsController } from './billing-settings.controller';
import { BillingSettingsService } from './billing-settings.service';
import { AccountController, GeneralSettingsController } from './general-settings.controller';
import { GeneralSettingsService } from './general-settings.service';

/** Paramètres du traiteur (entreprise, documents et paiements, disponibilités, prix, site client) et compte. */
@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [BillingSettingsController, GeneralSettingsController, AccountController],
  providers: [BillingSettingsService, GeneralSettingsService, AccountService],
})
export class SettingsModule {}
