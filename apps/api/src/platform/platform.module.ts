import { Module } from '@nestjs/common';

import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';

/** Console de la plateforme : gestion des traiteurs, offres, audit (SUPER_ADMIN). */
@Module({
  controllers: [PlatformController],
  providers: [PlatformDashboardService, PlatformGuard],
})
export class PlatformModule {}
