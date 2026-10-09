import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
  type Download,
  downloadSchema,
  type ManualAcceptanceInput,
  manualAcceptanceSchema,
  type Quote,
  type QuoteCreateInput,
  quoteCreateSchema,
  type QuoteLink,
  quoteLinkSchema,
  quoteSchema,
  type QuoteSendResult,
  quoteSendResultSchema,
  type QuoteUpdateInput,
  quoteUpdateSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequireFeature, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { QuotesService } from './quotes.service';

const quoteResponse = { schema: zodToOpenApi(quoteSchema, 'output') };

@ApiTags('quotes')
@ApiBearerAuth()
@RequireFeature('quotes')
@Controller()
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get('orders/:orderId/quotes')
  @RequirePermissions('quotes.read')
  @ApiOperation({ summary: 'Versions du devis de la commande (la plus récente d’abord)' })
  @ApiOkResponse({ schema: zodToOpenApi(z.array(quoteSchema), 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
  ): Promise<Quote[]> {
    return this.quotes.list(user, orderId);
  }

  @Post('orders/:orderId/quotes')
  @RequirePermissions('quotes.manage')
  @ApiOperation({
    summary: 'Prépare un brouillon depuis les lignes de la commande (nouvelle version si besoin)',
  })
  @ApiBody({ schema: zodToOpenApi(quoteCreateSchema) })
  @ApiOkResponse(quoteResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', uuidParam) orderId: string,
    @Body(new ZodValidationPipe(quoteCreateSchema)) body: QuoteCreateInput,
    @Client() client: ClientInfo,
  ): Promise<Quote> {
    return this.quotes.create(user, orderId, body, client);
  }

  @Patch('quotes/:id')
  @RequirePermissions('quotes.manage')
  @ApiBody({ schema: zodToOpenApi(quoteUpdateSchema) })
  @ApiOkResponse(quoteResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(quoteUpdateSchema)) body: QuoteUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<Quote> {
    return this.quotes.update(user, id, body, client);
  }

  @Post('quotes/:id/send')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotes.manage')
  @ApiOperation({
    summary:
      'Envoie le devis : PDF figé, lien sécurisé (affiché une fois), commande « Devis envoyé »',
  })
  @ApiOkResponse({ schema: zodToOpenApi(quoteSendResultSchema, 'output') })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<QuoteSendResult> {
    return this.quotes.send(user, id, client);
  }

  @Post('quotes/:id/link')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotes.manage')
  @ApiOperation({ summary: 'Nouveau lien sécurisé (le précédent est révoqué)' })
  @ApiOkResponse({ schema: zodToOpenApi(quoteLinkSchema, 'output') })
  renewLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<QuoteLink> {
    return this.quotes.renewLink(user, id, client);
  }

  @Post('quotes/:id/revoke-link')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotes.manage')
  @ApiOkResponse(quoteResponse)
  revokeLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Quote> {
    return this.quotes.revokeLink(user, id, client);
  }

  @Get('quotes/:id/pdf')
  @RequirePermissions('quotes.read')
  @ApiOperation({ summary: 'PDF du devis : URL de téléchargement signée (5 minutes)' })
  @ApiOkResponse({ schema: zodToOpenApi(downloadSchema, 'output') })
  pdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Download> {
    return this.quotes.pdfDownload(user, id);
  }

  @Get('quotes/:id/acceptance-attachment')
  @RequirePermissions('quotes.read')
  @ApiOkResponse({ schema: zodToOpenApi(downloadSchema, 'output') })
  attachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<Download> {
    return this.quotes.attachmentDownload(user, id);
  }

  @Post('quotes/:id/accept')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Enregistre l’accord du client (téléphone, devis papier signé…) : même effet que l’accord en ligne',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'mode'],
      properties: {
        name: { type: 'string' },
        mode: { type: 'string', enum: ['PHONE', 'PAPER', 'OTHER'] },
        note: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse(quoteResponse)
  acceptManually(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(manualAcceptanceSchema)) body: ManualAcceptanceInput,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Client() client: ClientInfo,
  ): Promise<Quote> {
    return this.quotes.acceptManually(user, id, body, file, client);
  }
}
