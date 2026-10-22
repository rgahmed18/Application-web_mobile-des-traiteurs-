import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type PlatformDashboard, platformDashboardSchema } from '@traiteur/shared';

import { zodToOpenApi } from '../common/zod/zod-openapi';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformGuard } from './platform.guard';

/** Console de la plateforme (SUPER_ADMIN, session plateforme uniquement). */
@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly dashboards: PlatformDashboardService) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Tableau de bord : traiteurs par statut, commandes du mois, abonnements estimés, essais, activité (chiffres agrégés)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(platformDashboardSchema, 'output') })
  dashboard(): Promise<PlatformDashboard> {
    return this.dashboards.dashboard();
  }
}
