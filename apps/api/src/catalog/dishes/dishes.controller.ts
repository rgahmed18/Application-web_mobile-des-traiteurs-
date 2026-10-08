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
  type Dish,
  type DishInput,
  dishInputSchema,
  type DishListQuery,
  dishListQuerySchema,
  dishPageSchema,
  dishSchema,
  type DishPage,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import { Client, type ClientInfo } from '../../common/http/client-info';
import { zodToOpenApi } from '../../common/zod/zod-openapi';
import { ZodValidationPipe } from '../../common/zod/zod-validation.pipe';
import { uuidParam } from '../catalog-http';
import { DishesService } from './dishes.service';

const dishResponse = { schema: zodToOpenApi(dishSchema, 'output') };

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog/dishes')
export class DishesController {
  constructor(private readonly dishes: DishesService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Plats : recherche, filtres, pagination' })
  @ApiOkResponse({ schema: zodToOpenApi(dishPageSchema, 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(dishListQuerySchema)) query: DishListQuery,
  ): Promise<DishPage> {
    return this.dishes.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('catalog.read')
  @ApiOkResponse(dishResponse)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string): Promise<Dish> {
    return this.dishes.get(user, id);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiOperation({
    summary: 'Crée un plat ; le prix est saisi dans le mode du traiteur (HT ou TTC)',
  })
  @ApiBody({ schema: zodToOpenApi(dishInputSchema) })
  @ApiOkResponse(dishResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(dishInputSchema)) body: DishInput,
    @Client() client: ClientInfo,
  ): Promise<Dish> {
    return this.dishes.create(user, body, client);
  }

  @Put(':id')
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(dishInputSchema) })
  @ApiOkResponse(dishResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(dishInputSchema)) body: DishInput,
    @Client() client: ClientInfo,
  ): Promise<Dish> {
    return this.dishes.update(user, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Retire le plat du catalogue (conservé pour l’historique)' })
  @ApiOkResponse(dishResponse)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Dish> {
    return this.dishes.archive(user, id, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOkResponse(dishResponse)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Dish> {
    return this.dishes.restore(user, id, client);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Suppression définitive, seulement si le plat n’a jamais servi' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.dishes.remove(user, id, client);
  }
}
