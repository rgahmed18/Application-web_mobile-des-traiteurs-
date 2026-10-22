import { Module } from '@nestjs/common';

import { StaffModule } from '../staff/staff.module';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformTraiteursService } from './platform-traiteurs.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';

/** Console de la plateforme : gestion des traiteurs, offres, audit (SUPER_ADMIN). */
@Module({
  imports: [StaffModule],
  controllers: [PlatformController],
  providers: [PlatformDashboardService, PlatformTraiteursService, PlatformGuard],
})
export class PlatformModule {}
