import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type DepositUpdateInput,
  depositUpdateSchema,
  type Download,
  downloadSchema,
  type OrderPayments,
  orderPaymentsSchema,
  type PaymentInput,
  paymentInputSchema,
  type RefundInput,
  refundInputSchema,
  type VoidPaymentInput,
  voidPaymentSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { PaymentsService } from './payments.service';

const paymentsResponse = { schema: zodToOpenApi(orderPaymentsSchema, 'output') };

@ApiTags('payments')
@ApiBearerAuth()
@Controller('orders/:orderId')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  @RequirePermissions('payments.read')
  @ApiOperation({ summary: 'Échéancier, encaissements et remboursements de la commande' })
  @ApiOkResponse(paymentsResponse)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
  ): Promise<OrderPayments> {
    return this.payments.forOrder(user, orderId);
  }

  @Post('payments')
  @RequirePermissions('payments.record')
  @ApiOperation({
    summary:
      'Enregistre un encaissement (reçu REC-… numéroté) ; le total payé ne dépasse jamais le TTC',
  })
  @ApiBody({ schema: zodToOpenApi(paymentInputSchema) })
  @ApiOkResponse(paymentsResponse)
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Body(new ZodValidationPipe(paymentInputSchema)) body: PaymentInput,
    @Client() client: ClientInfo,
  ): Promise<OrderPayments> {
    return this.payments.record(user, orderId, body, client);
  }

  @Post('refunds')
  @RequirePermissions('payments.refund')
  @ApiBody({ schema: zodToOpenApi(refundInputSchema) })
  @ApiOkResponse(paymentsResponse)
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Body(new ZodValidationPipe(refundInputSchema)) body: RefundInput,
    @Client() client: ClientInfo,
  ): Promise<OrderPayments> {
    return this.payments.refund(user, orderId, body, client);
  }

  @Post('payments/:paymentId/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.refund')
  @ApiOperation({ summary: 'Annule un encaissement saisi par erreur (motif obligatoire)' })
  @ApiBody({ schema: zodToOpenApi(voidPaymentSchema) })
  @ApiOkResponse(paymentsResponse)
  void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Param('paymentId', uuidParam) paymentId: string,
    @Body(new ZodValidationPipe(voidPaymentSchema)) body: VoidPaymentInput,
    @Client() client: ClientInfo,
  ): Promise<OrderPayments> {
    return this.payments.void(user, orderId, paymentId, body, client);
  }

  @Get('payments/:paymentId/receipt')
  @RequirePermissions('payments.read')
  @ApiOperation({ summary: 'Reçu PDF : URL de téléchargement signée (5 minutes)' })
  @ApiOkResponse({ schema: zodToOpenApi(downloadSchema, 'output') })
  receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Param('paymentId', uuidParam) paymentId: string,
  ): Promise<Download> {
    return this.payments.receipt(user, orderId, paymentId);
  }

  @Put('deposit')
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Ajuste l’acompte demandé (figé à la confirmation)' })
  @ApiBody({ schema: zodToOpenApi(depositUpdateSchema) })
  @ApiOkResponse(paymentsResponse)
  setDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Body(new ZodValidationPipe(depositUpdateSchema)) body: DepositUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<OrderPayments> {
    return this.payments.setDeposit(user, orderId, body, client);
  }
}
