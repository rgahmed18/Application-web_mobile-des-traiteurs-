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
  type BlockedDateInput,
  blockedDateInputSchema,
  type Calendar,
  type CalendarQuery,
  calendarQuerySchema,
  calendarSchema,
  type CapacityInput,
  capacityInputSchema,
  type Dashboard,
  dashboardSchema,
  localDateSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { CalendarService } from './calendar.service';

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermissions('calendar.read')
  @ApiOperation({ summary: 'Commandes, dates bloquées et charge par jour sur une période' })
  @ApiOkResponse({ schema: zodToOpenApi(calendarSchema, 'output') })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(calendarQuerySchema)) query: CalendarQuery,
  ): Promise<Calendar> {
    return this.calendar.get(user, query);
  }

  @Post('blocked-dates')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('calendar.manage')
  @ApiBody({ schema: zodToOpenApi(blockedDateInputSchema) })
  @ApiNoContentResponse()
  block(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(blockedDateInputSchema)) body: BlockedDateInput,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.calendar.blockDate(user, body, client);
  }

  @Delete('blocked-dates/:date')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('calendar.manage')
  @ApiNoContentResponse()
  unblock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('date', new ZodValidationPipe(localDateSchema)) date: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.calendar.unblockDate(user, date, client);
  }

  @Put('capacity')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('calendar.manage')
  @ApiOperation({ summary: 'Nombre maximum d’événements fermes par jour (null = sans limite)' })
  @ApiBody({ schema: zodToOpenApi(capacityInputSchema) })
  @ApiNoContentResponse()
  setCapacity(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(capacityInputSchema)) body: CapacityInput,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.calendar.setCapacity(user, body, client);
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Cartes du tableau de bord (fuseau du traiteur)' })
  @ApiOkResponse({ schema: zodToOpenApi(dashboardSchema, 'output') })
  get(@CurrentUser() user: AuthenticatedUser): Promise<Dashboard> {
    return this.calendar.dashboard(user);
  }
}
