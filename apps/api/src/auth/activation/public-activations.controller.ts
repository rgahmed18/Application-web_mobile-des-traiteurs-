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
  type ActivationAcceptInput,
  type ActivationAcceptResult,
  activationAcceptResultSchema,
  activationAcceptSchema,
  type PublicActivation,
  publicActivationSchema,
} from '@traiteur/shared';

import { Client, type ClientInfo } from '../../common/http/client-info';
import { PublicDocumentHeaders } from '../../common/http/public-document.interceptor';
import { zodToOpenApi } from '../../common/zod/zod-openapi';
import { ZodValidationPipe } from '../../common/zod/zod-validation.pipe';
import { Public } from '../decorators';
import { ActivationsService } from './activations.service';

/** Activation d'un compte de la plateforme par son lien, sans connexion. Débit limité. */
@ApiTags('public')
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@UseInterceptors(PublicDocumentHeaders)
@Controller('public/activations/:token')
export class PublicActivationsController {
  constructor(private readonly activations: ActivationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lien d’activation à consulter (prénom, téléphone masqué)' })
  @ApiOkResponse({ schema: zodToOpenApi(publicActivationSchema, 'output') })
  view(@Param('token') token: string): Promise<PublicActivation> {
    return this.activations.view(token);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Choix du mot de passe (usage unique, 24 heures)' })
  @ApiBody({ schema: zodToOpenApi(activationAcceptSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(activationAcceptResultSchema, 'output') })
  accept(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(activationAcceptSchema)) body: ActivationAcceptInput,
    @Client() client: ClientInfo,
  ): Promise<ActivationAcceptResult> {
    return this.activations.accept(token, body, client);
  }
}
