import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type ClientAccount,
  clientAccountSchema,
  type ClientAvailability,
  type ClientAvailabilityQuery,
  clientAvailabilityQuerySchema,
  clientAvailabilitySchema,
  type ClientRequestCreated,
  clientRequestCreatedSchema,
  type ClientRequestInput,
  clientRequestSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions, Roles } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ClientAccountService } from './client-account.service';
import { ClientRequestsService } from './client-requests.service';

/**
 * Espace du client sur le site du traiteur : toujours SA fiche chez CE traiteur (session), jamais
 * un identifiant venu de la requête.
 */
@ApiTags('client')
@ApiBearerAuth()
@Roles('CLIENT')
@Controller('client')
@UseGuards(ThrottlerGuard)
export class ClientSiteController {
  constructor(
    private readonly account: ClientAccountService,
    private readonly requests: ClientRequestsService,
  ) {}

  @Get('account')
  @ApiOperation({ summary: 'Coordonnées chez ce traiteur, accord du traiteur, demandes possibles' })
  @ApiOkResponse({ schema: zodToOpenApi(clientAccountSchema, 'output') })
  getAccount(@CurrentUser() user: AuthenticatedUser): Promise<ClientAccount> {
    return this.account.get(user);
  }

  @Post('availability')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Date et matériel : « disponible » ou « sur demande », jamais de capacité ni de stock',
  })
  @ApiBody({ schema: zodToOpenApi(clientAvailabilityQuerySchema) })
  @ApiOkResponse({ schema: zodToOpenApi(clientAvailabilitySchema, 'output') })
  availability(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(clientAvailabilityQuerySchema)) body: ClientAvailabilityQuery,
  ): Promise<ClientAvailability> {
    return this.requests.availability(user, body);
  }

  @Post('requests')
  @RequirePermissions('orders.create')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Envoie une demande : commande « En attente », lignes et prix du catalogue publié (limites par jour et en attente)',
  })
  @ApiBody({ schema: zodToOpenApi(clientRequestSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(clientRequestCreatedSchema, 'output') })
  createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(clientRequestSchema)) body: ClientRequestInput,
    @Client() client: ClientInfo,
  ): Promise<ClientRequestCreated> {
    return this.requests.create(user, body, client);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Annule sa demande tant qu’elle est « En attente »' })
  @ApiNoContentResponse()
  cancelRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.requests.cancel(user, id, client);
  }
}
