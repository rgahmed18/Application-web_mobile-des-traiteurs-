import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CashDesk,
  cashDeskSchema,
  type CashRejectInput,
  cashRejectSchema,
  type Download,
  downloadSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { CashDeskService } from './cash-desk.service';

const deskResponse = { schema: zodToOpenApi(cashDeskSchema, 'output') };

@ApiTags('payments')
@ApiBearerAuth()
@Controller('cash-desk')
export class CashDeskController {
  constructor(private readonly cashDesk: CashDeskService) {}

  @Get()
  @RequirePermissions('payments.record')
  @ApiOperation({ summary: 'Caisse livreurs : encaissements déclarés non encore remis' })
  @ApiOkResponse(deskResponse)
  desk(@CurrentUser() user: AuthenticatedUser): Promise<CashDesk> {
    return this.cashDesk.desk(user);
  }

  @Post(':paymentId/remit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.record')
  @ApiOperation({
    summary: 'Argent remis : l’encaissement compte et reçoit son reçu numéroté (REC-…)',
  })
  @ApiOkResponse(deskResponse)
  remit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId', uuidParam) paymentId: string,
    @Client() client: ClientInfo,
  ): Promise<CashDesk> {
    return this.cashDesk.remit(user, paymentId, client);
  }

  @Post(':paymentId/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.record')
  @ApiOperation({ summary: 'Refuse une déclaration (motif obligatoire), jamais comptée' })
  @ApiBody({ schema: zodToOpenApi(cashRejectSchema) })
  @ApiOkResponse(deskResponse)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId', uuidParam) paymentId: string,
    @Body(new ZodValidationPipe(cashRejectSchema)) body: CashRejectInput,
    @Client() client: ClientInfo,
  ): Promise<CashDesk> {
    return this.cashDesk.reject(user, paymentId, body, client);
  }

  @Get(':paymentId/cheque-photo')
  @RequirePermissions('payments.record')
  @ApiOperation({ summary: 'Photo du chèque : URL signée (5 minutes)' })
  @ApiOkResponse({ schema: zodToOpenApi(downloadSchema, 'output') })
  chequePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId', uuidParam) paymentId: string,
  ): Promise<Download> {
    return this.cashDesk.chequePhoto(user, paymentId);
  }
}
