import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
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
  PLATFORM_MATRIX_ROLES,
  type PlatformPermissionMatrix,
  platformPermissionMatrixSchema,
  type PlatformPermissionUpdateInput,
  platformPermissionUpdateSchema,
  type PlatformAuditOptions,
  platformAuditOptionsSchema,
  type PlatformAuditPage,
  platformAuditPageSchema,
  type PlatformAuditQuery,
  platformAuditQuerySchema,
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
  featureKeySchema,
  type PlatformFeatureToggleInput,
  platformFeatureToggleSchema,
  type PlatformPlanChangeInput,
  platformPlanChangeSchema,
  type PlatformPlanPriceInput,
  platformPlanPriceSchema,
  type PlatformPlans,
  platformPlansSchema,
  type PlatformSuspendInput,
  platformSuspendSchema,
  type PlatformTraiteurDetail,
  platformTraiteurDetailSchema,
  type PlatformTrialUpdateInput,
  platformTrialUpdateSchema,
  subscriptionPlanSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformPermissionsService } from './platform-permissions.service';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformTraiteurAdminService } from './platform-traiteur-admin.service';
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
    private readonly admin: PlatformTraiteurAdminService,
    private readonly plans: PlatformPlansService,
    private readonly audit: PlatformAuditService,
    private readonly permissionMatrix: PlatformPermissionsService,
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

  @Get('traiteurs/:id')
  @ApiOperation({
    summary: 'Fiche d’un traiteur : offre, fonctionnalités, essai, suspension, historique',
  })
  @ApiOkResponse({ schema: zodToOpenApi(platformTraiteurDetailSchema, 'output') })
  traiteur(@Param('id', uuidParam) id: string): Promise<PlatformTraiteurDetail> {
    return this.admin.detail(id);
  }

  @Put('traiteurs/:id/plan')
  @ApiOperation({
    summary: 'Change l’offre (fonctionnalités remises à celles de l’offre au choix)',
  })
  @ApiBody({ schema: zodToOpenApi(platformPlanChangeSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(platformTraiteurDetailSchema, 'output') })
  changePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(platformPlanChangeSchema)) body: PlatformPlanChangeInput,
    @Client() client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    return this.admin.changePlan(user, id, body, client);
  }

  @Put('traiteurs/:id/features/:key')
  @ApiOperation({ summary: 'Active ou désactive une fonctionnalité pour ce traiteur' })
  @ApiBody({ schema: zodToOpenApi(platformFeatureToggleSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(platformTraiteurDetailSchema, 'output') })
  toggleFeature(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Param('key', new ZodValidationPipe(featureKeySchema))
    key: (typeof featureKeySchema)['options'][number],
    @Body(new ZodValidationPipe(platformFeatureToggleSchema)) body: PlatformFeatureToggleInput,
    @Client() client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    return this.admin.toggleFeature(user, id, key, body.enabled, client);
  }

  @Post('traiteurs/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend le traiteur (motif obligatoire) : accès coupé aussitôt' })
  @ApiBody({ schema: zodToOpenApi(platformSuspendSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(platformTraiteurDetailSchema, 'output') })
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(platformSuspendSchema)) body: PlatformSuspendInput,
    @Client() client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    return this.admin.suspend(user, id, body.reason, client);
  }

  @Post('traiteurs/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réactive un traiteur suspendu (essai s’il n’est pas terminé)' })
  @ApiOkResponse({ schema: zodToOpenApi(platformTraiteurDetailSchema, 'output') })
  reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    return this.admin.reactivate(user, id, client);
  }

  @Put('traiteurs/:id/trial')
  @ApiOperation({ summary: 'Fin de l’essai : prolonger ou raccourcir' })
  @ApiBody({ schema: zodToOpenApi(platformTrialUpdateSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(platformTraiteurDetailSchema, 'output') })
  updateTrial(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(platformTrialUpdateSchema)) body: PlatformTrialUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    return this.admin.updateTrial(user, id, body.trialEndsOn, client);
  }

  @Post('traiteurs/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Termine l’essai : abonnement actif tout de suite' })
  @ApiOkResponse({ schema: zodToOpenApi(platformTraiteurDetailSchema, 'output') })
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    return this.admin.activateSubscription(user, id, client);
  }

  @Get('plans')
  @ApiOperation({ summary: 'Offres : prix en vigueur, historique, fonctionnalités, traiteurs' })
  @ApiOkResponse({ schema: zodToOpenApi(platformPlansSchema, 'output') })
  listPlans(): Promise<PlatformPlans> {
    return this.plans.plans();
  }

  @Put('plans/:plan/price')
  @ApiOperation({ summary: 'Nouveau prix mensuel, en vigueur tout de suite (historique conservé)' })
  @ApiBody({ schema: zodToOpenApi(platformPlanPriceSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(platformPlansSchema, 'output') })
  setPlanPrice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('plan', new ZodValidationPipe(subscriptionPlanSchema))
    plan: (typeof subscriptionPlanSchema)['options'][number],
    @Body(new ZodValidationPipe(platformPlanPriceSchema)) body: PlatformPlanPriceInput,
    @Client() client: ClientInfo,
  ): Promise<PlatformPlans> {
    return this.plans.setPrice(user, plan, body.monthlyPrice, client);
  }

  @Get('audit')
  @ApiOperation({
    summary:
      'Journal d’audit : qui, quoi, chez quel traiteur, quand (sans le contenu des actions des traiteurs)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(platformAuditPageSchema, 'output') })
  auditLog(
    @Query(new ZodValidationPipe(platformAuditQuerySchema)) query: PlatformAuditQuery,
  ): Promise<PlatformAuditPage> {
    return this.audit.list(query);
  }

  @Get('audit/options')
  @ApiOperation({ summary: 'Valeurs des filtres du journal : super admins, actions, traiteurs' })
  @ApiOkResponse({ schema: zodToOpenApi(platformAuditOptionsSchema, 'output') })
  auditOptions(): Promise<PlatformAuditOptions> {
    return this.audit.options();
  }

  @Get('permissions')
  @ApiOperation({ summary: 'Matrice des permissions par défaut (tous les traiteurs)' })
  @ApiOkResponse({ schema: zodToOpenApi(platformPermissionMatrixSchema, 'output') })
  permissions(): Promise<PlatformPermissionMatrix> {
    return this.permissionMatrix.matrix();
  }

  @Put('permissions/:role/:key')
  @ApiOperation({
    summary:
      'Accorde ou retire une permission à un rôle dans la matrice par défaut (case conservée au déploiement)',
  })
  @ApiBody({ schema: zodToOpenApi(platformPermissionUpdateSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(platformPermissionMatrixSchema, 'output') })
  setPermission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('role', new ZodValidationPipe(z.enum(PLATFORM_MATRIX_ROLES)))
    role: (typeof PLATFORM_MATRIX_ROLES)[number],
    @Param('key', new ZodValidationPipe(z.string().regex(/^[a-z_]+\.[a-z_]+$/))) key: string,
    @Body(new ZodValidationPipe(platformPermissionUpdateSchema))
    body: PlatformPermissionUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<PlatformPermissionMatrix> {
    return this.permissionMatrix.setDefault(user, key, role, body.granted, client);
  }
}
