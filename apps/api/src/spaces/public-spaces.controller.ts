import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type DemoSpaces,
  demoSpacesSchema,
  type Space,
  spaceResolveQuerySchema,
  spaceSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import { Public } from '../auth/decorators';
import { appErrors } from '../common/errors';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { SpacesService } from './spaces.service';

const tlsQuerySchema = z.object({ domain: z.string().trim().min(1).max(260) });

/**
 * Espace servi par une adresse, pour le serveur web (page de connexion, contrôle de la session)
 * et pour Caddy (certificats HTTPS à la demande). Sans connexion ; débit large car le serveur web
 * appelle depuis une seule adresse (avec un cache de son côté).
 */
@ApiTags('public')
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 1_200, ttl: 60_000 } })
@Controller('public/spaces')
export class PublicSpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get('resolve')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Espace servi par une adresse : console ou back-office d’un traiteur' })
  @ApiOkResponse({ schema: zodToOpenApi(spaceSchema, 'output') })
  async resolve(
    @Query(new ZodValidationPipe(spaceResolveQuerySchema)) query: { host: string },
  ): Promise<Space> {
    const space = await this.spaces.resolve(query.host);
    if (!space) throw appErrors.notFound('SPACE_NOT_FOUND', 'Espace introuvable');
    return space;
  }

  /**
   * Caddy « on_demand_tls ask » : 200 seulement pour une adresse qui sert un espace (traiteur
   * existant, ou domaine personnalisé vérifié et actif) ; sinon 404, et aucun certificat n'est
   * demandé.
   */
  @Get('tls-check')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Certificat HTTPS autorisé pour cette adresse (Caddy)' })
  async tlsCheck(
    @Query(new ZodValidationPipe(tlsQuerySchema)) query: { domain: string },
  ): Promise<{ allowed: true }> {
    if (!(await this.spaces.resolve(query.domain))) {
      throw appErrors.notFound('SPACE_NOT_FOUND', 'Espace introuvable');
    }
    return { allowed: true };
  }

  @Get('demo')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Démonstration uniquement : traiteurs proposés au choix' })
  @ApiOkResponse({ schema: zodToOpenApi(demoSpacesSchema, 'output') })
  async demo(): Promise<DemoSpaces> {
    const spaces = await this.spaces.demoSpaces();
    if (!spaces) throw appErrors.notFound('NOT_FOUND', 'Introuvable');
    return spaces;
  }

  @Get('demo/:slug')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Démonstration uniquement : espace du traiteur choisi' })
  @ApiOkResponse({ schema: zodToOpenApi(spaceSchema, 'output') })
  async demoSpace(@Param('slug') slug: string): Promise<Space> {
    const space = await this.spaces.demoSpace(slug);
    if (!space) throw appErrors.notFound('SPACE_NOT_FOUND', 'Espace introuvable');
    return space;
  }
}
