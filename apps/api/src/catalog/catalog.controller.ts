import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CatalogSettings,
  catalogSettingsSchema,
  type CompletedUpload,
  completedUploadSchema,
  type CreateUploadInput,
  createUploadSchema,
  type UploadTicket,
  uploadTicketSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { loadCatalogSettings, requireTraiteurId } from './catalog-common';
import { uuidParam } from './catalog-http';
import { MediaService } from './media/media.service';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  @Get('settings')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Mode de saisie des prix (HT / TTC) et TVA du traiteur' })
  @ApiOkResponse({ schema: zodToOpenApi(catalogSettingsSchema, 'output') })
  settings(@CurrentUser() user: AuthenticatedUser): Promise<CatalogSettings> {
    return loadCatalogSettings(this.prisma, requireTraiteurId(user));
  }

  @Post('uploads')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'URL d’envoi direct d’une photo (JPEG, PNG ou WebP, 5 Mo maximum)' })
  @ApiBody({ schema: zodToOpenApi(createUploadSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(uploadTicketSchema, 'output') })
  createUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createUploadSchema)) body: CreateUploadInput,
  ): Promise<UploadTicket> {
    return this.media.createUpload(requireTraiteurId(user), body);
  }

  @Post('uploads/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Vérifie, redimensionne et nettoie la photo envoyée' })
  @ApiOkResponse({ schema: zodToOpenApi(completedUploadSchema, 'output') })
  completeUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<CompletedUpload> {
    return this.media.completeUpload(requireTraiteurId(user), id);
  }
}
