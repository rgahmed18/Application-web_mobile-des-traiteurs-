import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Category,
  type CategoryInput,
  categoryInputSchema,
  type CategoryReorderInput,
  categoryReorderSchema,
  categorySchema,
} from '@traiteur/shared';
import { z } from 'zod';

import type { AuthenticatedUser } from '../../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import { Client, type ClientInfo } from '../../common/http/client-info';
import { zodToOpenApi } from '../../common/zod/zod-openapi';
import { ZodValidationPipe } from '../../common/zod/zod-validation.pipe';
import { uuidParam } from '../../common/http/uuid-param';
import { CategoriesService } from './categories.service';

const categoryResponse = { schema: zodToOpenApi(categorySchema, 'output') };
const categoryListResponse = { schema: zodToOpenApi(z.array(categorySchema), 'output') };

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Catégories, dans l’ordre d’affichage' })
  @ApiOkResponse(categoryListResponse)
  list(@CurrentUser() user: AuthenticatedUser): Promise<Category[]> {
    return this.categories.list(user);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(categoryInputSchema) })
  @ApiOkResponse(categoryResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(categoryInputSchema)) body: CategoryInput,
    @Client() client: ClientInfo,
  ): Promise<Category> {
    return this.categories.create(user, body, client);
  }

  /** Avant /:id : « order » n'est pas un identifiant. */
  @Put('order')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Nouvel ordre d’affichage (glisser-déposer)' })
  @ApiBody({ schema: zodToOpenApi(categoryReorderSchema) })
  @ApiOkResponse(categoryListResponse)
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(categoryReorderSchema)) body: CategoryReorderInput,
    @Client() client: ClientInfo,
  ): Promise<Category[]> {
    return this.categories.reorder(user, body, client);
  }

  @Patch(':id')
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(categoryInputSchema) })
  @ApiOkResponse(categoryResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(categoryInputSchema)) body: CategoryInput,
    @Client() client: ClientInfo,
  ): Promise<Category> {
    return this.categories.update(user, id, body, client);
  }
}
