import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthSession,
  authSessionSchema,
  type PlatformAccess,
  type PlatformAccessReasonInput,
  platformAccessReasonSchema,
  platformAccessSchema,
} from '@traiteur/shared';

import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { PlatformGuard } from '../platform/platform.guard';
import type { AuthenticatedUser } from './auth-user';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators';

/**
 * Accès du super admin chez un traiteur (dépannage) : entrée avec motif depuis la console,
 * prolongation et sortie depuis le back-office du traiteur. Tout est tracé dans l'audit.
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
export class PlatformAccessController {
  constructor(private readonly auth: AuthService) {}

  @Post('traiteurs/:id/enter')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformGuard)
  @ApiOperation({
    summary: 'Entre chez un traiteur (motif obligatoire) : session limitée à ce traiteur, 2 heures',
  })
  @ApiBody({ schema: zodToOpenApi(platformAccessReasonSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(authSessionSchema, 'output') })
  enter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(platformAccessReasonSchema)) body: PlatformAccessReasonInput,
    @Client() client: ClientInfo,
  ): Promise<AuthSession> {
    return this.auth.enterTraiteur(user, id, body.reason, client);
  }

  @Post('access/extend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Prolonge l’accès en cours de 2 heures (nouveau motif obligatoire)' })
  @ApiBody({ schema: zodToOpenApi(platformAccessReasonSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(platformAccessSchema, 'output') })
  extend(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(platformAccessReasonSchema)) body: PlatformAccessReasonInput,
    @Client() client: ClientInfo,
  ): Promise<PlatformAccess> {
    return this.auth.extendPlatformAccess(user, body.reason, client);
  }

  @Post('access/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quitte le traiteur et revient à la console (nouvelle session)' })
  @ApiOkResponse({ schema: zodToOpenApi(authSessionSchema, 'output') })
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<AuthSession> {
    return this.auth.leaveTraiteur(user, client);
  }
}
