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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type ClientAccount,
  clientAccountSchema,
  type ClientAccountUpdateInput,
  clientAccountUpdateSchema,
  type ClientAddress,
  type ClientAddressInput,
  clientAddressInputSchema,
  clientAddressSchema,
  type ClientDashboard,
  clientDashboardSchema,
  type ClientInvoice,
  clientInvoiceSchema,
  type ClientOrder,
  clientOrderSchema,
  type ClientOrderSummary,
  clientOrderSummarySchema,
  type ClientPayment,
  clientPaymentSchema,
  type ClientQuoteRejectInput,
  clientQuoteRejectSchema,
  type ClientQuoteSummary,
  clientQuoteSummarySchema,
  type Download,
  downloadSchema,
  type PublicAcceptInput,
  publicAcceptSchema,
  type PublicQuote,
  publicQuoteSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions, Roles } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { QuotesService } from '../quotes/quotes.service';
import { requireClient } from './client-account.service';
import { ClientSpaceService } from './client-space.service';

const langQuery = z.object({ lang: z.enum(['fr', 'ar']).optional() });

/**
 * Espace du client sur le site du traiteur : ses demandes et commandes, devis (consulter,
 * accepter, refuser), factures, reçus, paiements, profil et adresses. Toujours la fiche de la
 * session ; un élément d'un autre client ou d'un autre traiteur répond 404.
 */
@ApiTags('client')
@ApiBearerAuth()
@Roles('CLIENT')
@Controller('client')
@UseGuards(ThrottlerGuard)
export class ClientSpaceController {
  constructor(
    private readonly space: ClientSpaceService,
    private readonly quotes: QuotesService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('orders.read_own')
  @ApiOperation({ summary: 'Demandes en cours, devis à traiter, prochaine échéance' })
  @ApiOkResponse({ schema: zodToOpenApi(clientDashboardSchema, 'output') })
  dashboard(@CurrentUser() user: AuthenticatedUser): Promise<ClientDashboard> {
    return this.space.dashboard(user);
  }

  @Get('orders')
  @RequirePermissions('orders.read_own')
  @ApiOkResponse({ schema: zodToOpenApi(z.array(clientOrderSummarySchema), 'output') })
  orders(@CurrentUser() user: AuthenticatedUser): Promise<ClientOrderSummary[]> {
    return this.space.orders(user);
  }

  @Get('orders/:id')
  @RequirePermissions('orders.read_own')
  @ApiOperation({ summary: 'Demande ou commande : lignes, historique, devis, factures, paiements' })
  @ApiOkResponse({ schema: zodToOpenApi(clientOrderSchema, 'output') })
  order(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<ClientOrder> {
    return this.space.order(user, id);
  }

  @Get('quotes')
  @RequirePermissions('orders.read_own')
  @ApiOkResponse({ schema: zodToOpenApi(z.array(clientQuoteSummarySchema), 'output') })
  quoteList(@CurrentUser() user: AuthenticatedUser): Promise<ClientQuoteSummary[]> {
    return this.space.quotes(user);
  }

  @Get('quotes/:id')
  @RequirePermissions('orders.read_own')
  @ApiOkResponse({ schema: zodToOpenApi(publicQuoteSchema, 'output') })
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Query(new ZodValidationPipe(langQuery)) query: z.infer<typeof langQuery>,
  ): Promise<PublicQuote> {
    const { traiteurId, membershipId } = requireClient(user);
    return this.quotes.clientView(traiteurId, membershipId, id, query.lang ?? null);
  }

  @Post('quotes/:id/accept')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotes.respond')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Accepte le devis (nom saisi, « bon pour accord ») : commande confirmée',
  })
  @ApiBody({ schema: zodToOpenApi(publicAcceptSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(publicQuoteSchema, 'output') })
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(publicAcceptSchema)) body: PublicAcceptInput,
    @Client() client: ClientInfo,
  ): Promise<PublicQuote> {
    return this.quotes.clientAccept(user, requireClient(user).membershipId, id, body, client);
  }

  @Post('quotes/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotes.respond')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Refuse le devis (motif facultatif) : la demande revient en attente' })
  @ApiBody({ schema: zodToOpenApi(clientQuoteRejectSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(publicQuoteSchema, 'output') })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(clientQuoteRejectSchema)) body: ClientQuoteRejectInput,
    @Client() client: ClientInfo,
  ): Promise<PublicQuote> {
    return this.quotes.clientReject(
      user,
      requireClient(user).membershipId,
      id,
      body.reason,
      client,
    );
  }

  @Get('quotes/:id/pdf')
  @RequirePermissions('orders.read_own')
  @ApiOkResponse({ schema: zodToOpenApi(downloadSchema, 'output') })
  quotePdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Download> {
    return this.quotes.clientPdf(user, requireClient(user).membershipId, id);
  }

  @Get('invoices')
  @RequirePermissions('orders.read_own')
  @ApiOkResponse({ schema: zodToOpenApi(z.array(clientInvoiceSchema), 'output') })
  invoices(@CurrentUser() user: AuthenticatedUser): Promise<ClientInvoice[]> {
    return this.space.invoices(user);
  }

  @Get('invoices/:id/pdf')
  @RequirePermissions('orders.read_own')
  @ApiOkResponse({ schema: zodToOpenApi(downloadSchema, 'output') })
  invoicePdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Download> {
    return this.space.invoicePdf(user, id);
  }

  @Get('payments')
  @RequirePermissions('orders.read_own')
  @ApiOkResponse({ schema: zodToOpenApi(z.array(clientPaymentSchema), 'output') })
  payments(@CurrentUser() user: AuthenticatedUser): Promise<ClientPayment[]> {
    return this.space.payments(user);
  }

  @Get('payments/:id/receipt')
  @RequirePermissions('orders.read_own')
  @ApiOkResponse({ schema: zodToOpenApi(downloadSchema, 'output') })
  receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Download> {
    return this.space.receipt(user, id);
  }

  @Put('account')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Nom, e-mail et langue chez ce traiteur (fiche du client)' })
  @ApiBody({ schema: zodToOpenApi(clientAccountUpdateSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(clientAccountSchema, 'output') })
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(clientAccountUpdateSchema)) body: ClientAccountUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<ClientAccount> {
    return this.space.updateAccount(user, body, client);
  }

  @Get('addresses')
  @ApiOkResponse({ schema: zodToOpenApi(z.array(clientAddressSchema), 'output') })
  addresses(@CurrentUser() user: AuthenticatedUser): Promise<ClientAddress[]> {
    return this.space.addresses(user);
  }

  @Post('addresses')
  @ApiBody({ schema: zodToOpenApi(clientAddressInputSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(z.array(clientAddressSchema), 'output') })
  addAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(clientAddressInputSchema)) body: ClientAddressInput,
  ): Promise<ClientAddress[]> {
    return this.space.saveAddress(user, null, body);
  }

  @Put('addresses/:id')
  @ApiBody({ schema: zodToOpenApi(clientAddressInputSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(z.array(clientAddressSchema), 'output') })
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(clientAddressInputSchema)) body: ClientAddressInput,
  ): Promise<ClientAddress[]> {
    return this.space.saveAddress(user, id, body);
  }

  @Delete('addresses/:id')
  @ApiOkResponse({ schema: zodToOpenApi(z.array(clientAddressSchema), 'output') })
  removeAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<ClientAddress[]> {
    return this.space.removeAddress(user, id);
  }
}
