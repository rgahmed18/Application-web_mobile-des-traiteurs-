import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  invitationLinkSchema,
  type InvitationLink,
  type PermissionsMatrix,
  permissionsMatrixSchema,
  type PermissionsResetInput,
  permissionsResetSchema,
  type PermissionsUpdateInput,
  permissionsUpdateSchema,
  type StaffInviteInput,
  type StaffInviteResult,
  staffInviteResultSchema,
  staffInviteSchema,
  type StaffListQuery,
  staffListQuerySchema,
  type StaffMember,
  staffMemberSchema,
  type StaffSuspendInput,
  staffSuspendSchema,
  type StaffUpdateInput,
  staffUpdateSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { RolePermissionsService } from './role-permissions.service';
import { StaffService } from './staff.service';

const memberResponse = { schema: zodToOpenApi(staffMemberSchema, 'output') };
const inviteResponse = { schema: zodToOpenApi(staffInviteResultSchema, 'output') };
const reactivateSchema = z.object({
  member: staffMemberSchema,
  link: invitationLinkSchema.nullable(),
});

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('staff.read')
  @ApiOperation({ summary: 'Équipe du traiteur (administrateurs, bureau, équipe, livreurs)' })
  @ApiOkResponse({ schema: zodToOpenApi(z.array(staffMemberSchema), 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(staffListQuerySchema)) query: StaffListQuery,
  ): Promise<StaffMember[]> {
    return this.staff.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('staff.read')
  @ApiOkResponse(memberResponse)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<StaffMember> {
    return this.staff.get(user, id);
  }

  @Post('invitations')
  @RequirePermissions('staff.manage')
  @ApiOperation({
    summary: 'Invite un membre : lien d’activation (SMS si possible), affiché une fois',
  })
  @ApiBody({ schema: zodToOpenApi(staffInviteSchema) })
  @ApiOkResponse(inviteResponse)
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(staffInviteSchema)) body: StaffInviteInput,
    @Client() client: ClientInfo,
  ): Promise<StaffInviteResult> {
    return this.staff.invite(user, body, client);
  }

  @Post(':id/invitation')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('staff.manage')
  @ApiOperation({ summary: 'Nouveau lien d’activation (le précédent est révoqué)' })
  @ApiOkResponse(inviteResponse)
  renewInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<StaffInviteResult> {
    return this.staff.renewInvitation(user, id, client);
  }

  @Delete(':id/invitation')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('staff.manage')
  @ApiOperation({ summary: 'Annule une invitation jamais activée (le membre est retiré)' })
  async cancelInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.staff.cancelInvitation(user, id, client);
  }

  @Put(':id')
  @RequirePermissions('staff.manage')
  @ApiBody({ schema: zodToOpenApi(staffUpdateSchema) })
  @ApiOkResponse(memberResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(staffUpdateSchema)) body: StaffUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<StaffMember> {
    return this.staff.update(user, id, body, client);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('staff.manage')
  @ApiOperation({ summary: 'Suspend un membre : accès refusé immédiatement, sessions révoquées' })
  @ApiBody({ schema: zodToOpenApi(staffSuspendSchema) })
  @ApiOkResponse(memberResponse)
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(staffSuspendSchema)) body: StaffSuspendInput,
    @Client() client: ClientInfo,
  ): Promise<StaffMember> {
    return this.staff.suspend(user, id, body, client);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('staff.manage')
  @ApiOkResponse({ schema: zodToOpenApi(reactivateSchema, 'output') })
  reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<{ member: StaffMember; link: InvitationLink | null }> {
    return this.staff.reactivate(user, id, client);
  }
}

@ApiTags('staff')
@ApiBearerAuth()
@Controller('settings/permissions')
export class RolePermissionsController {
  constructor(private readonly permissions: RolePermissionsService) {}

  @Get()
  @RequirePermissions('permissions.manage')
  @ApiOperation({ summary: 'Grille des permissions par rôle du personnel' })
  @ApiOkResponse({ schema: zodToOpenApi(permissionsMatrixSchema, 'output') })
  matrix(@CurrentUser() user: AuthenticatedUser): Promise<PermissionsMatrix> {
    return this.permissions.matrix(user);
  }

  @Put()
  @RequirePermissions('permissions.manage')
  @ApiBody({ schema: zodToOpenApi(permissionsUpdateSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(permissionsMatrixSchema, 'output') })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(permissionsUpdateSchema)) body: PermissionsUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<PermissionsMatrix> {
    return this.permissions.update(user, body, client);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('permissions.manage')
  @ApiOperation({ summary: 'Rétablit les valeurs par défaut (un rôle ou tous)' })
  @ApiBody({ schema: zodToOpenApi(permissionsResetSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(permissionsMatrixSchema, 'output') })
  reset(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(permissionsResetSchema)) body: PermissionsResetInput,
    @Client() client: ClientInfo,
  ): Promise<PermissionsMatrix> {
    return this.permissions.reset(user, body, client);
  }
}
