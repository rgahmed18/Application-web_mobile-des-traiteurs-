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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type PublicAcceptInput,
  publicAcceptSchema,
  type PublicQuote,
  publicQuoteSchema,
  type PublicRejectInput,
  publicRejectSchema,
} from '@traiteur/shared';

import { Public } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { PublicDocumentHeaders } from './public-document.interceptor';
import { QuotesService } from './quotes.service';

const response = { schema: zodToOpenApi(publicQuoteSchema, 'output') };

/**
 * Devis consulté par le client via son lien sécurisé, sans connexion. Jeton invalide, révoqué
 * ou trop ancien : 404. Débit limité par adresse IP.
 */
@ApiTags('public')
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@UseInterceptors(PublicDocumentHeaders)
@Controller('public/quotes/:token')
export class PublicQuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @ApiOperation({ summary: 'Devis à consulter (page publique)' })
  @ApiOkResponse(response)
  view(@Param('token') token: string, @Query('lang') lang?: string): Promise<PublicQuote> {
    return this.quotes.publicView(token, lang === 'ar' || lang === 'fr' ? lang : null);
  }

  @Get('pdf')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'PDF du devis' })
  async pdf(@Param('token') token: string): Promise<StreamableFile> {
    const { pdf, fileName } = await this.quotes.publicPdf(token);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${fileName}"`,
      length: pdf.length,
    });
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Accord du client : nom saisi, heure, IP et navigateur tracés' })
  @ApiBody({ schema: zodToOpenApi(publicAcceptSchema) })
  @ApiOkResponse(response)
  accept(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(publicAcceptSchema)) body: PublicAcceptInput,
    @Client() client: ClientInfo,
  ): Promise<PublicQuote> {
    return this.quotes.publicAccept(token, body, client);
  }

  @Post('reject')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBody({ schema: zodToOpenApi(publicRejectSchema) })
  @ApiOkResponse(response)
  reject(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(publicRejectSchema)) body: PublicRejectInput,
    @Client() client: ClientInfo,
  ): Promise<PublicQuote> {
    return this.quotes.publicReject(token, body, client);
  }
}
