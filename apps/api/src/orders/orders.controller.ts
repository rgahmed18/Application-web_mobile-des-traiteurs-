import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Availability,
  type AvailabilityQuery,
  availabilityQuerySchema,
  availabilitySchema,
  type Order,
  type OrderCreateInput,
  orderCreateSchema,
  type OrderHistoryEntry,
  orderHistoryEntrySchema,
  type OrderListQuery,
  orderListQuerySchema,
  type OrderPage,
  orderPageSchema,
  orderSchema,
  type OrderTransitionInput,
  orderTransitionSchema,
  type OrderUpdateInput,
  orderUpdateSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { OrdersService } from './orders.service';

const orderResponse = { schema: zodToOpenApi(orderSchema, 'output') };

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('orders.read')
  @ApiOperation({
    summary: 'Commandes : filtres statut, période, type ; recherche référence ou client',
  })
  @ApiOkResponse({ schema: zodToOpenApi(orderPageSchema, 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
  ): Promise<OrderPage> {
    return this.orders.list(user, query);
  }

  @Get('availability')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Disponibilité d’un jour : date bloquée, capacité, commandes' })
  @ApiOkResponse({ schema: zodToOpenApi(availabilitySchema, 'output') })
  availability(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ): Promise<Availability> {
    return this.orders.availability(user, query.date, query.excludeOrderId);
  }

  @Get(':id')
  @RequirePermissions('orders.read')
  @ApiOkResponse(orderResponse)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string): Promise<Order> {
    return this.orders.get(user, id);
  }

  @Get(':id/history')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Historique : statuts et modifications, avec auteur et motif' })
  @ApiOkResponse({ schema: zodToOpenApi(z.array(orderHistoryEntrySchema), 'output') })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<OrderHistoryEntry[]> {
    return this.orders.history(user, id);
  }

  @Post()
  @RequirePermissions('orders.create')
  @ApiOperation({
    summary:
      'Crée une commande et ses lignes ; 409 AVAILABILITY_CONFLICT si la date est bloquée ou complète (forceAvailability pour passer outre)',
  })
  @ApiBody({ schema: zodToOpenApi(orderCreateSchema) })
  @ApiOkResponse(orderResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(orderCreateSchema)) body: OrderCreateInput,
    @Client() client: ClientInfo,
  ): Promise<Order> {
    return this.orders.create(user, body, client);
  }

  @Put(':id')
  @RequirePermissions('orders.write')
  @ApiOperation({
    summary:
      'Modifie une commande (version obligatoire, 409 ORDER_VERSION_CONFLICT si elle a changé) ; motif exigé une fois confirmée',
  })
  @ApiBody({ schema: zodToOpenApi(orderUpdateSchema) })
  @ApiOkResponse(orderResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(orderUpdateSchema)) body: OrderUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<Order> {
    return this.orders.update(user, id, body, client);
  }

  @Post(':id/transitions')
  @HttpCode(HttpStatus.OK)
  // Pas de permission unique : la machine à états exige la bonne selon la transition
  // (orders.write, orders.cancel, ou deliveries.update_status pour le livreur).
  @ApiOperation({
    summary: 'Change le statut selon la machine à états (motif pour une annulation)',
  })
  @ApiBody({ schema: zodToOpenApi(orderTransitionSchema) })
  @ApiOkResponse(orderResponse)
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(orderTransitionSchema)) body: OrderTransitionInput,
    @Client() client: ClientInfo,
  ): Promise<Order> {
    return this.orders.transition(user, id, body, client);
  }
}
