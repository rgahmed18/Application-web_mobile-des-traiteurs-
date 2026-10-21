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
  type Equipment,
  type EquipmentAvailability,
  type EquipmentAvailabilityQuery,
  equipmentAvailabilityQuerySchema,
  equipmentAvailabilitySchema,
  type EquipmentInput,
  equipmentInputSchema,
  type EquipmentListQuery,
  equipmentListQuerySchema,
  type EquipmentPage,
  equipmentPageSchema,
  equipmentSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import { Client, type ClientInfo } from '../../common/http/client-info';
import { uuidParam } from '../../common/http/uuid-param';
import { zodToOpenApi } from '../../common/zod/zod-openapi';
import { ZodValidationPipe } from '../../common/zod/zod-validation.pipe';
import { EquipmentService } from './equipment.service';

const equipmentResponse = { schema: zodToOpenApi(equipmentSchema, 'output') };

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog/equipment')
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Matériel : recherche, filtres (catégorie, gamme), pagination' })
  @ApiOkResponse({ schema: zodToOpenApi(equipmentPageSchema, 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(equipmentListQuerySchema)) query: EquipmentListQuery,
  ): Promise<EquipmentPage> {
    return this.equipment.list(user, query);
  }

  @Get('availability')
  @RequirePermissions('catalog.read')
  @ApiOperation({
    summary:
      'Disponibilité sur une période : stock, réservé (commandes fermes), en attente, restant',
  })
  @ApiOkResponse({ schema: zodToOpenApi(equipmentAvailabilitySchema, 'output') })
  availability(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(equipmentAvailabilityQuerySchema))
    query: EquipmentAvailabilityQuery,
  ): Promise<EquipmentAvailability> {
    return this.equipment.availability(user, query);
  }

  @Get(':id')
  @RequirePermissions('catalog.read')
  @ApiOkResponse(equipmentResponse)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Equipment> {
    return this.equipment.get(user, id);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(equipmentInputSchema) })
  @ApiOkResponse(equipmentResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(equipmentInputSchema)) body: EquipmentInput,
    @Client() client: ClientInfo,
  ): Promise<Equipment> {
    return this.equipment.create(user, body, client);
  }

  @Put(':id')
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(equipmentInputSchema) })
  @ApiOkResponse(equipmentResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(equipmentInputSchema)) body: EquipmentInput,
    @Client() client: ClientInfo,
  ): Promise<Equipment> {
    return this.equipment.update(user, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOkResponse(equipmentResponse)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Equipment> {
    return this.equipment.archive(user, id, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOkResponse(equipmentResponse)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Equipment> {
    return this.equipment.restore(user, id, client);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Supprime un article jamais utilisé (409 sinon : l’archiver)' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.equipment.remove(user, id, client);
  }
}
