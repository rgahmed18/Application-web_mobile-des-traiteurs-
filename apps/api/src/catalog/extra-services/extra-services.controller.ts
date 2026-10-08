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
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  archivedQuerySchema,
  type ExtraService,
  type ExtraServiceInput,
  extraServiceInputSchema,
  extraServiceSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import type { AuthenticatedUser } from '../../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import { Client, type ClientInfo } from '../../common/http/client-info';
import { zodToOpenApi } from '../../common/zod/zod-openapi';
import { ZodValidationPipe } from '../../common/zod/zod-validation.pipe';
import { uuidParam } from '../catalog-http';
import { ExtraServicesService } from './extra-services.service';

const serviceResponse = { schema: zodToOpenApi(extraServiceSchema, 'output') };

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog/services')
export class ExtraServicesController {
  constructor(private readonly services: ExtraServicesService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOkResponse({ schema: zodToOpenApi(z.array(extraServiceSchema), 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(archivedQuerySchema)) query: z.infer<typeof archivedQuerySchema>,
  ): Promise<ExtraService[]> {
    return this.services.list(user, query.archived ?? false);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(extraServiceInputSchema) })
  @ApiOkResponse(serviceResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(extraServiceInputSchema)) body: ExtraServiceInput,
    @Client() client: ClientInfo,
  ): Promise<ExtraService> {
    return this.services.create(user, body, client);
  }

  @Put(':id')
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(extraServiceInputSchema) })
  @ApiOkResponse(serviceResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(extraServiceInputSchema)) body: ExtraServiceInput,
    @Client() client: ClientInfo,
  ): Promise<ExtraService> {
    return this.services.update(user, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOkResponse(serviceResponse)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<ExtraService> {
    return this.services.archive(user, id, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOkResponse(serviceResponse)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<ExtraService> {
    return this.services.restore(user, id, client);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.write')
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.services.remove(user, id, client);
  }
}
