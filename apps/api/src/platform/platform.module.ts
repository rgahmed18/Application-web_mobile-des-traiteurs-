import { Module } from '@nestjs/common';

import { StaffModule } from '../staff/staff.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformTraiteurAdminService } from './platform-traiteur-admin.service';
import { PlatformTraiteursService } from './platform-traiteurs.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';

/** Console de la plateforme : gestion des traiteurs, offres, audit (SUPER_ADMIN). */
@Module({
  imports: [StaffModule],
  controllers: [PlatformController],
  providers: [
    PlatformDashboardService,
    PlatformTraiteursService,
    PlatformTraiteurAdminService,
    PlatformPlansService,
    PlatformAuditService,
    PlatformGuard,
  ],
})
export class PlatformModule {}
