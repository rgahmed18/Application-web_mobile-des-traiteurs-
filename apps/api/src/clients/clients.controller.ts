import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Client,
  type ClientAddressInput,
  clientAddressInputSchema,
  type ClientCreateInput,
  clientCreateSchema,
  type ClientListQuery,
  clientListQuerySchema,
  type ClientPage,
  clientPageSchema,
  type ClientRejectInput,
  clientRejectSchema,
  clientSchema,
  type ClientUpdateInput,
  clientUpdateSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Client as ClientMeta, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ClientsService } from './clients.service';
import { ExpectedVersion } from '../common/http/edit-version';

const clientResponse = { schema: zodToOpenApi(clientSchema, 'output') };

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermissions('clients.read')
  @ApiOperation({ summary: 'Clients : recherche (nom, téléphone), tri, pagination' })
  @ApiOkResponse({ schema: zodToOpenApi(clientPageSchema, 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(clientListQuerySchema)) query: ClientListQuery,
  ): Promise<ClientPage> {
    return this.clients.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('clients.read')
  @ApiOkResponse(clientResponse)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string): Promise<Client> {
    return this.clients.get(user, id);
  }

  @Post()
  @RequirePermissions('clients.write')
  @ApiOperation({
    summary: 'Crée un client sans mot de passe ; un numéro déjà inscrit est rattaché, sans doublon',
  })
  @ApiBody({ schema: zodToOpenApi(clientCreateSchema) })
  @ApiOkResponse(clientResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(clientCreateSchema)) body: ClientCreateInput,
    @ClientMeta() client: ClientInfo,
  ): Promise<Client> {
    return this.clients.create(user, body, client);
  }

  @Put(':id')
  @RequirePermissions('clients.write')
  @ApiBody({ schema: zodToOpenApi(clientUpdateSchema) })
  @ApiOkResponse(clientResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(clientUpdateSchema)) body: ClientUpdateInput,
    @ClientMeta() client: ClientInfo,
    @ExpectedVersion() expectedVersion: string | null,
  ): Promise<Client> {
    return this.clients.update(user, id, body, client, expectedVersion);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('clients.approve')
  @ApiOperation({ summary: 'Accepter un client inscrit en ligne (il est prévenu)' })
  @ApiOkResponse(clientResponse)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @ClientMeta() client: ClientInfo,
  ): Promise<Client> {
    return this.clients.approve(user, id, client);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('clients.approve')
  @ApiOperation({ summary: 'Refuser un client inscrit en ligne, avec motif (il est prévenu)' })
  @ApiBody({ schema: zodToOpenApi(clientRejectSchema) })
  @ApiOkResponse(clientResponse)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(clientRejectSchema)) body: ClientRejectInput,
    @ClientMeta() client: ClientInfo,
  ): Promise<Client> {
    return this.clients.reject(user, id, body.reason, client);
  }

  @Post(':id/addresses')
  @RequirePermissions('clients.write')
  @ApiBody({ schema: zodToOpenApi(clientAddressInputSchema) })
  @ApiOkResponse(clientResponse)
  addAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(clientAddressInputSchema)) body: ClientAddressInput,
    @ClientMeta() client: ClientInfo,
  ): Promise<Client> {
    return this.clients.addAddress(user, id, body, client);
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermissions('clients.write')
  @ApiBody({ schema: zodToOpenApi(clientAddressInputSchema) })
  @ApiOkResponse(clientResponse)
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Param('addressId', uuidParam) addressId: string,
    @Body(new ZodValidationPipe(clientAddressInputSchema)) body: ClientAddressInput,
    @ClientMeta() client: ClientInfo,
  ): Promise<Client> {
    return this.clients.updateAddress(user, id, addressId, body, client);
  }

  @Delete(':id/addresses/:addressId')
  @RequirePermissions('clients.write')
  @ApiOkResponse(clientResponse)
  removeAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Param('addressId', uuidParam) addressId: string,
    @ClientMeta() client: ClientInfo,
  ): Promise<Client> {
    return this.clients.removeAddress(user, id, addressId, client);
  }
}
