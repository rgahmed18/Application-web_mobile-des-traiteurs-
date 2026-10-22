import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type PlatformDashboard,
  platformDashboardSchema,
  type PlatformTraiteurCreateInput,
  type PlatformTraiteurCreateResult,
  platformTraiteurCreateResultSchema,
  platformTraiteurCreateSchema,
  type PlatformTraiteurListQuery,
  platformTraiteurListQuerySchema,
  type PlatformTraiteurPage,
  platformTraiteurPageSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformTraiteursService } from './platform-traiteurs.service';
import { PlatformGuard } from './platform.guard';

/** Console de la plateforme (SUPER_ADMIN, session plateforme uniquement). */
@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly dashboards: PlatformDashboardService,
    private readonly traiteurs: PlatformTraiteursService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Tableau de bord : traiteurs par statut, commandes du mois, abonnements estimés, essais, activité (chiffres agrégés)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(platformDashboardSchema, 'output') })
  dashboard(): Promise<PlatformDashboard> {
    return this.dashboards.dashboard();
  }

  @Get('traiteurs')
  @ApiOperation({
    summary: 'Traiteurs : identité, offre, statut, activité du mois, administrateur',
  })
  @ApiOkResponse({ schema: zodToOpenApi(platformTraiteurPageSchema, 'output') })
  listTraiteurs(
    @Query(new ZodValidationPipe(platformTraiteurListQuerySchema)) query: PlatformTraiteurListQuery,
  ): Promise<PlatformTraiteurPage> {
    return this.traiteurs.list(query);
  }

  @Post('traiteurs')
  @ApiOperation({
    summary:
      'Crée un traiteur (essai de N jours) et invite son administrateur : lien d’activation de 7 jours',
  })
  @ApiBody({ schema: zodToOpenApi(platformTraiteurCreateSchema) })
  @ApiCreatedResponse({ schema: zodToOpenApi(platformTraiteurCreateResultSchema, 'output') })
  createTraiteur(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(platformTraiteurCreateSchema)) body: PlatformTraiteurCreateInput,
    @Client() client: ClientInfo,
  ): Promise<PlatformTraiteurCreateResult> {
    return this.traiteurs.create(user, body, client);
  }

  @Post('traiteurs/:id/admin-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Nouveau lien d’activation de l’administrateur (le précédent est annulé)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(platformTraiteurCreateResultSchema, 'output') })
  resendAdminInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<PlatformTraiteurCreateResult> {
    return this.traiteurs.resendAdminInvitation(user, id, client);
  }
}
