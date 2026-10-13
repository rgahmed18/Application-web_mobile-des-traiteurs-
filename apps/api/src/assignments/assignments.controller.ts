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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type AssignmentInput,
  assignmentInputSchema,
  type AssignmentUpdateInput,
  assignmentUpdateSchema,
  type Download,
  downloadSchema,
  localDateSchema,
  type Mission,
  type MissionCollectInput,
  missionCollectSchema,
  type MissionDeclineInput,
  missionDeclineSchema,
  type MissionDeliveryInput,
  missionDeliverySchema,
  type MissionListQuery,
  missionListQuerySchema,
  missionSchema,
  type MissionSummary,
  missionSummarySchema,
  type OrderStaffing,
  orderStaffingSchema,
  type Planning,
  type PlanningQuery,
  planningQuerySchema,
  planningSchema,
  type ServiceInfoInput,
  serviceInfoSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { requireTraiteurId } from '../common/tenant';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AssignmentsService } from './assignments.service';
import { MissionsService } from './missions.service';
import { ServiceDocumentsService } from './service-documents.service';

const staffingResponse = { schema: zodToOpenApi(orderStaffingSchema, 'output') };
const downloadResponse = { schema: zodToOpenApi(downloadSchema, 'output') };
const localeQuery = z.object({ locale: z.enum(['fr', 'ar']).default('fr') });
const dayQuery = localeQuery.extend({ date: localDateSchema });

@ApiTags('assignments')
@ApiBearerAuth()
@Controller()
export class AssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly documents: ServiceDocumentsService,
  ) {}

  @Get('orders/:orderId/staffing')
  @RequirePermissions('staff.read')
  @ApiOperation({ summary: 'Personnel affecté, informations de service et alerte de la commande' })
  @ApiOkResponse(staffingResponse)
  staffing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
  ): Promise<OrderStaffing> {
    return this.assignments.forOrder(user, orderId);
  }

  @Post('orders/:orderId/assignments')
  @RequirePermissions('staff.manage')
  @ApiOperation({ summary: 'Affecte un membre (409 si chevauchement, sauf « force »)' })
  @ApiBody({ schema: zodToOpenApi(assignmentInputSchema) })
  @ApiOkResponse(staffingResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Body(new ZodValidationPipe(assignmentInputSchema)) body: AssignmentInput,
    @Client() client: ClientInfo,
  ): Promise<OrderStaffing> {
    return this.assignments.create(user, orderId, body, client);
  }

  @Put('assignments/:id')
  @RequirePermissions('staff.manage')
  @ApiBody({ schema: zodToOpenApi(assignmentUpdateSchema) })
  @ApiOkResponse(staffingResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(assignmentUpdateSchema)) body: AssignmentUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<OrderStaffing> {
    return this.assignments.update(user, id, body, client);
  }

  @Delete('assignments/:id')
  @RequirePermissions('staff.manage')
  @ApiOkResponse(staffingResponse)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<OrderStaffing> {
    return this.assignments.remove(user, id, client);
  }

  @Put('orders/:orderId/service-info')
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Contact sur place, notes de service et matériel (jamais au client)' })
  @ApiBody({ schema: zodToOpenApi(serviceInfoSchema) })
  @ApiOkResponse(staffingResponse)
  serviceInfo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Body(new ZodValidationPipe(serviceInfoSchema)) body: ServiceInfoInput,
    @Client() client: ClientInfo,
  ): Promise<OrderStaffing> {
    return this.assignments.updateServiceInfo(user, orderId, body, client);
  }

  @Get('assignments/planning')
  @RequirePermissions('staff.read')
  @ApiOperation({ summary: 'Planning de l’équipe : une semaine par personne' })
  @ApiOkResponse({ schema: zodToOpenApi(planningSchema, 'output') })
  planning(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(planningQuerySchema)) query: PlanningQuery,
  ): Promise<Planning> {
    return this.assignments.planning(user, query);
  }

  @Get('orders/:orderId/preparation-sheet')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Bon de préparation de l’événement (sans prix)' })
  @ApiOkResponse(downloadResponse)
  orderPreparation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Query(new ZodValidationPipe(localeQuery)) query: z.infer<typeof localeQuery>,
  ): Promise<Download> {
    return this.documents.orderPreparation(requireTraiteurId(user), orderId, query.locale);
  }

  @Get('orders/:orderId/delivery-note')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Bon de livraison (sans prix), dans la langue du client' })
  @ApiOkResponse(downloadResponse)
  deliveryNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
  ): Promise<Download> {
    return this.documents.deliveryNote(requireTraiteurId(user), orderId, null);
  }

  @Get('calendar/preparation-sheet')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Bon de préparation du jour : toutes les commandes fermes' })
  @ApiOkResponse(downloadResponse)
  dayPreparation(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(dayQuery)) query: z.infer<typeof dayQuery>,
  ): Promise<Download> {
    return this.documents.dayPreparation(requireTraiteurId(user), query.date, query.locale);
  }
}

@ApiTags('missions')
@ApiBearerAuth()
@Controller('me/missions')
export class MissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get()
  @RequirePermissions('assignments.read_own')
  @ApiOperation({ summary: 'Mes missions (à venir ou passées), sans aucun prix' })
  @ApiOkResponse({ schema: zodToOpenApi(z.array(missionSummarySchema), 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(missionListQuerySchema)) query: MissionListQuery,
  ): Promise<MissionSummary[]> {
    return this.missions.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('assignments.read_own')
  @ApiOkResponse({ schema: zodToOpenApi(missionSchema, 'output') })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Mission> {
    return this.missions.get(user, id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assignments.update_own')
  @ApiOkResponse({ schema: zodToOpenApi(missionSchema, 'output') })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Mission> {
    return this.missions.confirm(user, id, client);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assignments.update_own')
  @ApiOperation({ summary: '« Je ne peux pas » (motif) : alerte au tableau de bord' })
  @ApiBody({ schema: zodToOpenApi(missionDeclineSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(missionSchema, 'output') })
  decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(missionDeclineSchema)) body: MissionDeclineInput,
    @Client() client: ClientInfo,
  ): Promise<Mission> {
    return this.missions.decline(user, id, body, client);
  }

  @Post(':id/done')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assignments.update_own')
  @ApiOkResponse({ schema: zodToOpenApi(missionSchema, 'output') })
  finish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Mission> {
    return this.missions.finish(user, id, client);
  }

  @Post(':id/delivery')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('deliveries.update_status')
  @ApiOperation({ summary: 'Livraison : « Parti en livraison » puis « Livré »' })
  @ApiBody({ schema: zodToOpenApi(missionDeliverySchema) })
  @ApiOkResponse({ schema: zodToOpenApi(missionSchema, 'output') })
  delivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(missionDeliverySchema)) body: MissionDeliveryInput,
    @Client() client: ClientInfo,
  ): Promise<Mission> {
    return this.missions.deliveryStep(user, id, body, client);
  }

  @Post(':id/collect')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('deliveries.collect_cash')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      '« Encaissé » : montant reçu à la livraison (photo du chèque facultative), en attente de remise',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['amount', 'method'],
      properties: {
        amount: { type: 'integer', description: 'Centimes' },
        method: { type: 'string', enum: ['CASH', 'CHEQUE'] },
        reference: { type: 'string' },
        photo: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ schema: zodToOpenApi(missionSchema, 'output') })
  collect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(missionCollectSchema)) body: MissionCollectInput,
    @UploadedFile() photo: { buffer: Buffer; size: number } | undefined,
    @Client() client: ClientInfo,
  ): Promise<Mission> {
    return this.missions.collect(user, id, body, photo, client);
  }

  @Get(':id/delivery-note')
  @RequirePermissions('assignments.read_own')
  @ApiOkResponse(downloadResponse)
  deliveryNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Download> {
    return this.missions.deliveryNote(user, id);
  }

  @Get(':id/preparation-sheet')
  @RequirePermissions('assignments.read_own')
  @ApiOkResponse(downloadResponse)
  preparationSheet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Query(new ZodValidationPipe(localeQuery)) query: z.infer<typeof localeQuery>,
  ): Promise<Download> {
    return this.missions.preparationSheet(user, id, query.locale);
  }
}
