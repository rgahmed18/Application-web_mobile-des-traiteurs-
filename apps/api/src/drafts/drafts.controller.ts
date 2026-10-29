import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type Draft,
  draftFormKeySchema,
  type DraftList,
  draftListSchema,
  type DraftSaveInput,
  draftSaveSchema,
  draftSchema,
  type DraftSummary,
  draftSummarySchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { DraftsService } from './drafts.service';

const formKeyPipe = new ZodValidationPipe(draftFormKeySchema);

/**
 * Brouillons de l'utilisateur connecté, chez le traiteur de sa session (personnel seulement ;
 * le super admin pendant un accès chez un traiteur). Enregistrement automatique toutes les
 * quelques secondes : limite large.
 */
@ApiTags('drafts')
@ApiBearerAuth()
@Roles('ADMIN_TRAITEUR', 'EMPLOYE', 'EQUIPE', 'LIVREUR')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
@Controller('me/drafts')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Get()
  @ApiOperation({ summary: 'Mes brouillons chez ce traiteur (sans leur contenu)' })
  @ApiOkResponse({ schema: zodToOpenApi(draftListSchema, 'output') })
  list(@CurrentUser() user: AuthenticatedUser): Promise<DraftList> {
    return this.drafts.list(user);
  }

  @Get(':formKey')
  @ApiOperation({ summary: 'Un brouillon, avec son contenu' })
  @ApiOkResponse({ schema: zodToOpenApi(draftSchema, 'output') })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('formKey', formKeyPipe) formKey: string,
  ): Promise<Draft> {
    return this.drafts.get(user, formKey);
  }

  @Put(':formKey')
  @ApiOperation({ summary: 'Enregistre le brouillon (champs sensibles retirés)' })
  @ApiBody({ schema: zodToOpenApi(draftSaveSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(draftSummarySchema, 'output') })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('formKey', formKeyPipe) formKey: string,
    @Body(new ZodValidationPipe(draftSaveSchema)) body: DraftSaveInput,
  ): Promise<DraftSummary> {
    return this.drafts.save(user, formKey, body);
  }

  @Delete(':formKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprime le brouillon (enregistré pour de bon, ou abandonné)' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('formKey', formKeyPipe) formKey: string,
  ): Promise<void> {
    return this.drafts.remove(user, formKey);
  }
}
