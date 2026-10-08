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
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type Package,
  type PackageInput,
  packageInputSchema,
  type PackageListQuery,
  packageListQuerySchema,
  packagePageSchema,
  packageSchema,
  type PackagePage,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import { Client, type ClientInfo } from '../../common/http/client-info';
import { zodToOpenApi } from '../../common/zod/zod-openapi';
import { ZodValidationPipe } from '../../common/zod/zod-validation.pipe';
import { uuidParam } from '../catalog-http';
import { PackagesService } from './packages.service';

const packageResponse = { schema: zodToOpenApi(packageSchema, 'output') };

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog/packages')
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Formules : recherche, filtre, pagination' })
  @ApiOkResponse({ schema: zodToOpenApi(packagePageSchema, 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(packageListQuerySchema)) query: PackageListQuery,
  ): Promise<PackagePage> {
    return this.packages.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('catalog.read')
  @ApiOkResponse(packageResponse)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Package> {
    return this.packages.get(user, id);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiOperation({
    summary:
      'Crée une formule ; le prix par personne est saisi dans le mode du traiteur (HT ou TTC)',
  })
  @ApiBody({ schema: zodToOpenApi(packageInputSchema) })
  @ApiOkResponse(packageResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(packageInputSchema)) body: PackageInput,
    @Client() client: ClientInfo,
  ): Promise<Package> {
    return this.packages.create(user, body, client);
  }

  @Put(':id')
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(packageInputSchema) })
  @ApiOkResponse(packageResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(packageInputSchema)) body: PackageInput,
    @Client() client: ClientInfo,
  ): Promise<Package> {
    return this.packages.update(user, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Retire la formule du catalogue (conservé pour l’historique)' })
  @ApiOkResponse(packageResponse)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Package> {
    return this.packages.archive(user, id, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOkResponse(packageResponse)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Package> {
    return this.packages.restore(user, id, client);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Suppression définitive, seulement si la formule n’a jamais servi' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.packages.remove(user, id, client);
  }
}
