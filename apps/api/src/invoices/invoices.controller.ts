import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreditNoteInput,
  creditNoteInputSchema,
  type Download,
  downloadSchema,
  type InvoiceExportQuery,
  invoiceExportQuerySchema,
  type InvoiceIssueInput,
  invoiceIssueSchema,
  type InvoiceListQuery,
  invoiceListQuerySchema,
  type InvoicePage,
  invoicePageSchema,
  type OrderInvoicing,
  orderInvoicingSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequireFeature, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { InvoicesService } from './invoices.service';

const invoicingResponse = { schema: zodToOpenApi(orderInvoicingSchema, 'output') };

@ApiTags('invoices')
@ApiBearerAuth()
@RequireFeature('invoices')
@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('orders/:orderId/invoices')
  @RequirePermissions('invoices.read')
  @ApiOperation({ summary: 'Factures et avoirs de la commande, et factures possibles ensuite' })
  @ApiOkResponse(invoicingResponse)
  forOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
  ): Promise<OrderInvoicing> {
    return this.invoices.forOrder(user, orderId);
  }

  @Post('orders/:orderId/invoices')
  @RequirePermissions('invoices.issue')
  @ApiOperation({
    summary:
      'Émet une facture (totale, acompte, solde, frais d’annulation) datée du jour, numéro continu',
  })
  @ApiBody({ schema: zodToOpenApi(invoiceIssueSchema) })
  @ApiOkResponse(invoicingResponse)
  issue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Body(new ZodValidationPipe(invoiceIssueSchema)) body: InvoiceIssueInput,
    @Client() client: ClientInfo,
  ): Promise<OrderInvoicing> {
    return this.invoices.issue(user, orderId, body, client);
  }

  @Post('invoices/:id/credit-note')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('invoices.credit_note')
  @ApiOperation({ summary: 'Avoir total de la facture (motif obligatoire)' })
  @ApiBody({ schema: zodToOpenApi(creditNoteInputSchema) })
  @ApiOkResponse(invoicingResponse)
  creditNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(creditNoteInputSchema)) body: CreditNoteInput,
    @Client() client: ClientInfo,
  ): Promise<OrderInvoicing> {
    return this.invoices.creditNote(user, id, body, client);
  }

  @Get('invoices')
  @RequirePermissions('invoices.read')
  @ApiOperation({ summary: 'Factures et avoirs (période d’émission, type, recherche)' })
  @ApiOkResponse({ schema: zodToOpenApi(invoicePageSchema, 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(invoiceListQuerySchema)) query: InvoiceListQuery,
  ): Promise<InvoicePage> {
    return this.invoices.list(user, query);
  }

  @Get('invoices/export')
  @RequirePermissions('invoices.read')
  @ApiOperation({
    summary: 'Export comptable : xlsx, ou CSV pour Excel (UTF-8 avec BOM, séparateur « ; »)',
  })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(invoiceExportQuerySchema)) query: InvoiceExportQuery,
  ): Promise<StreamableFile> {
    const file = await this.invoices.export(user, query);
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.body.length,
    });
  }

  @Get('invoices/:id/pdf')
  @RequirePermissions('invoices.read')
  @ApiOperation({ summary: 'PDF figé de la facture : URL de téléchargement signée (5 minutes)' })
  @ApiOkResponse({ schema: zodToOpenApi(downloadSchema, 'output') })
  pdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Download> {
    return this.invoices.pdfDownload(user, id);
  }
}
