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
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CatalogList,
  type CatalogListItem,
  type CatalogListItemInput,
  catalogListItemInputSchema,
  catalogListItemSchema,
  type CatalogListReorderInput,
  catalogListReorderSchema,
  catalogListSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import type { AuthenticatedUser } from '../../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import { Client, type ClientInfo } from '../../common/http/client-info';
import { uuidParam } from '../../common/http/uuid-param';
import { zodToOpenApi } from '../../common/zod/zod-openapi';
import { ZodValidationPipe } from '../../common/zod/zod-validation.pipe';
import { CatalogListsService } from './catalog-lists.service';

const itemResponse = { schema: zodToOpenApi(catalogListItemSchema, 'output') };
const listResponse = { schema: zodToOpenApi(z.array(catalogListItemSchema), 'output') };
const listParam = new ZodValidationPipe(catalogListSchema);

/**
 * Listes gérables du catalogue : « event-types » (types d'événement) et « ranges » (gammes).
 * Lecture : catalog.read (composer une commande) ; écriture : catalog.write (administrateur).
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog/lists/:list')
export class CatalogListsController {
  constructor(private readonly lists: CatalogListsService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Éléments de la liste, dans l’ordre d’affichage (archivés compris)' })
  @ApiOkResponse(listResponse)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list', listParam) list: CatalogList,
  ): Promise<CatalogListItem[]> {
    return this.lists.list(user, list);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Ajoute un élément (code stable généré depuis le nom français)' })
  @ApiBody({ schema: zodToOpenApi(catalogListItemInputSchema) })
  @ApiOkResponse(itemResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list', listParam) list: CatalogList,
    @Body(new ZodValidationPipe(catalogListItemInputSchema)) body: CatalogListItemInput,
    @Client() client: ClientInfo,
  ): Promise<CatalogListItem> {
    return this.lists.create(user, list, body, client);
  }

  @Put('order')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Nouvel ordre d’affichage' })
  @ApiBody({ schema: zodToOpenApi(catalogListReorderSchema) })
  @ApiOkResponse(listResponse)
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list', listParam) list: CatalogList,
    @Body(new ZodValidationPipe(catalogListReorderSchema)) body: CatalogListReorderInput,
    @Client() client: ClientInfo,
  ): Promise<CatalogListItem[]> {
    return this.lists.reorder(user, list, body, client);
  }

  @Patch(':id')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Renomme, décrit (gammes) ou active / désactive un élément' })
  @ApiBody({ schema: zodToOpenApi(catalogListItemInputSchema) })
  @ApiOkResponse(itemResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list', listParam) list: CatalogList,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(catalogListItemInputSchema)) body: CatalogListItemInput,
    @Client() client: ClientInfo,
  ): Promise<CatalogListItem> {
    return this.lists.update(user, list, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Archive un élément (retiré des nouvelles saisies)' })
  @ApiOkResponse(itemResponse)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list', listParam) list: CatalogList,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<CatalogListItem> {
    return this.lists.setArchived(user, list, id, true, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Remet un élément archivé dans la liste' })
  @ApiOkResponse(itemResponse)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list', listParam) list: CatalogList,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<CatalogListItem> {
    return this.lists.setArchived(user, list, id, false, client);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Supprime un élément jamais utilisé (409 sinon : l’archiver)' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list', listParam) list: CatalogList,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.lists.remove(user, list, id, client);
  }
}
