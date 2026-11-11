import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type PublicCatalog,
  type PublicCatalogOptions,
  type PublicCatalogQuery,
  publicCatalogOptionsSchema,
  publicCatalogQuerySchema,
  publicCatalogSchema,
  type PublicPrivacy,
  publicPrivacySchema,
  type PublicSite,
  publicSiteSchema,
} from '@traiteur/shared';

import { Public } from '../../auth/decorators';
import { zodToOpenApi } from '../../common/zod/zod-openapi';
import { ZodValidationPipe } from '../../common/zod/zod-validation.pipe';
import { PublicCatalogService } from './public-catalog.service';

/** Identifiant d'URL d'un traiteur : minuscules, chiffres et tirets. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Slug malformé : traité comme inconnu (pas de requête en base). */
function publicSlug(value: string): string {
  return SLUG.test(value) && value.length <= 60 ? value : '-';
}

/**
 * Catalogue public d'un traiteur pour son site client, sans connexion et en lecture seule.
 * Débit limité par adresse IP ; réponses cachées une minute (navigateur, CDN et Redis).
 */
@ApiTags('public')
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('public/traiteurs/:slug/catalog')
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Get('options')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Types d’événement et gammes proposés par le traiteur' })
  @ApiOkResponse({ schema: zodToOpenApi(publicCatalogOptionsSchema, 'output') })
  options(@Param('slug') slug: string): Promise<PublicCatalogOptions> {
    return this.catalog.options(publicSlug(slug));
  }

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary:
      'Menus, buffets, matériel et services publiés (prix TTC, photos, FR/AR), filtrés par type d’événement et gamme',
  })
  @ApiOkResponse({ schema: zodToOpenApi(publicCatalogSchema, 'output') })
  list(
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(publicCatalogQuerySchema)) query: PublicCatalogQuery,
  ): Promise<PublicCatalog> {
    return this.catalog.catalog(publicSlug(slug), query);
  }
}

/** Accueil et politique de confidentialité du site client d'un traiteur, sans connexion. */
@ApiTags('public')
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('public/traiteurs/:slug')
export class PublicSiteController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Get('site')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Accueil : présentation, contact public, photos (FR/AR)' })
  @ApiOkResponse({ schema: zodToOpenApi(publicSiteSchema, 'output') })
  site(@Param('slug') slug: string): Promise<PublicSite> {
    return this.catalog.site(publicSlug(slug));
  }

  @Get('privacy')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: 'Politique de confidentialité : responsable du traitement, CNDP, version à accepter',
  })
  @ApiOkResponse({ schema: zodToOpenApi(publicPrivacySchema, 'output') })
  privacy(@Param('slug') slug: string): Promise<PublicPrivacy> {
    return this.catalog.privacy(publicSlug(slug));
  }
}
