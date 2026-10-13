import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type InvitationAcceptInput,
  type InvitationAcceptResult,
  invitationAcceptResultSchema,
  invitationAcceptSchema,
  type PublicInvitation,
  publicInvitationSchema,
} from '@traiteur/shared';

import { Public } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { PublicDocumentHeaders } from '../common/http/public-document.interceptor';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { InvitationsService } from './invitations.service';

/**
 * Activation d'un accès du personnel par son lien, sans connexion. Jeton inconnu, utilisé ou
 * révoqué : 404 ; expiré : INVITATION_EXPIRED. Débit limité par adresse IP.
 */
@ApiTags('public')
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@UseInterceptors(PublicDocumentHeaders)
@Controller('public/invitations/:token')
export class PublicInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @ApiOperation({ summary: 'Invitation à consulter (page d’activation)' })
  @ApiOkResponse({ schema: zodToOpenApi(publicInvitationSchema, 'output') })
  view(@Param('token') token: string): Promise<PublicInvitation> {
    return this.invitations.view(token);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Active l’accès : nouveau mot de passe, ou mot de passe actuel d’un compte existant',
  })
  @ApiBody({ schema: zodToOpenApi(invitationAcceptSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(invitationAcceptResultSchema, 'output') })
  accept(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(invitationAcceptSchema)) body: InvitationAcceptInput,
    @Client() client: ClientInfo,
  ): Promise<InvitationAcceptResult> {
    return this.invitations.accept(token, body, client);
  }
}
