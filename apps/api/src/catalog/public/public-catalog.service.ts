import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  localizedTextSchema,
  type PublicCatalog,
  publicCatalogOptionsSchema,
  type PublicCatalogOptions,
  type PublicCatalogQuery,
  publicCatalogSchema,
  type PublicListItem,
} from '@traiteur/shared';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { appErrors } from '../../common/errors';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { StorageService } from '../../storage/storage.service';
import { toLocalized, toLocalizedOrNull } from '../catalog-common';

/** Réponses gardées une minute : le site client peut appeler à chaque visite. */
const CACHE_TTL_SECONDS = 60;

/** Traiteur suspendu ou résilié : son catalogue n'est plus publié (404, sans le dire). */
const UNPUBLISHED_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);

/** Élément publié : actif et non archivé. */
const published = { isActive: true, archivedAt: null } as const;
const listSelect = { code: true, name: true } as const;
const dishesInclude = {
  orderBy: { sortOrder: 'asc' },
  select: { quantity: true, dish: { select: { name: true } } },
} as const;

function listItem(
  row: { code: string; name: Prisma.JsonValue; description?: Prisma.JsonValue | null } | null,
): PublicListItem | null {
  if (!row) return null;
  return {
    code: row.code,
    name: toLocalized(row.name),
    description: toLocalizedOrNull(row.description ?? null),
  };
}

/**
 * Catalogue public d'un traiteur (lecture seule) pour son site client. Seuls les éléments actifs
 * et non archivés sont publiés, avec leurs prix TTC ; ni stock, ni prix de remplacement, ni prix
 * HT. Réponses mises en cache dans Redis (une minute) ; sans Redis, lecture directe.
 */
@Injectable()
export class PublicCatalogService {
  private readonly logger = new Logger(PublicCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async options(slug: string): Promise<PublicCatalogOptions> {
    return this.cached(`public-catalog:${slug}:options`, publicCatalogOptionsSchema, async () => {
      const traiteur = await this.traiteur(slug);
      const where = { traiteurId: traiteur.id, ...published };
      const orderBy = [{ sortOrder: 'asc' as const }, { code: 'asc' as const }];
      const [eventTypes, ranges] = await Promise.all([
        this.prisma.eventType.findMany({ where, orderBy, select: listSelect }),
        this.prisma.catalogRange.findMany({
          where,
          orderBy,
          select: { ...listSelect, description: true },
        }),
      ]);
      return {
        traiteur: { slug: traiteur.slug, name: traiteur.name },
        currency: traiteur.currency,
        eventTypes: eventTypes.flatMap((row) => listItem(row) ?? []),
        ranges: ranges.flatMap((row) => listItem(row) ?? []),
      };
    });
  }

  async catalog(slug: string, query: PublicCatalogQuery): Promise<PublicCatalog> {
    const key = `public-catalog:${slug}:catalog:${query.eventType ?? '*'}:${query.range ?? '*'}`;
    return this.cached(key, publicCatalogSchema, async () => {
      const traiteur = await this.traiteur(slug);
      const traiteurId = traiteur.id;
      // Gamme demandée : seulement si elle est publiée (sinon aucun résultat)
      const range = query.range ? { code: query.range, ...published } : undefined;
      const rangeFilter = range ? { range } : {};
      const listRef = { select: { ...listSelect, isActive: true, archivedAt: true } } as const;

      const [menus, buffets, equipment] = await Promise.all([
        this.prisma.package.findMany({
          where: {
            traiteurId,
            ...published,
            ...rangeFilter,
            ...(query.eventType
              ? {
                  OR: [
                    {
                      eventTypes: { some: { eventType: { code: query.eventType, ...published } } },
                    },
                    { eventTypes: { none: {} } },
                  ],
                }
              : {}),
          },
          orderBy: { slug: 'asc' },
          include: {
            range: {
              select: { ...listSelect, description: true, isActive: true, archivedAt: true },
            },
            dishes: dishesInclude,
            eventTypes: { include: { eventType: listRef } },
          },
        }),
        this.prisma.buffet.findMany({
          where: { traiteurId, ...published, ...rangeFilter },
          orderBy: { slug: 'asc' },
          include: {
            type: listRef,
            range: {
              select: { ...listSelect, description: true, isActive: true, archivedAt: true },
            },
            dishes: dishesInclude,
          },
        }),
        this.prisma.equipmentItem.findMany({
          where: { traiteurId, ...published, ...rangeFilter },
          orderBy: { slug: 'asc' },
          include: {
            category: listRef,
            range: {
              select: { ...listSelect, description: true, isActive: true, archivedAt: true },
            },
          },
        }),
      ]);

      // Liste archivée ou désactivée : l'élément reste publié, sans cette mention
      const visible = <T extends { isActive: boolean; archivedAt: Date | null }>(row: T | null) =>
        row && row.isActive && !row.archivedAt ? row : null;
      const image = (key: string | null) => (key ? this.storage.publicFileUrl(key) : null);
      const dishes = (rows: { quantity: number; dish: { name: Prisma.JsonValue } }[]) =>
        rows.map((row) => ({ name: toLocalized(row.dish.name), quantity: row.quantity }));
      const freeItems = z.array(localizedTextSchema);

      return {
        currency: traiteur.currency,
        menus: menus.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: toLocalized(row.name),
          description: toLocalizedOrNull(row.description),
          imageUrl: image(row.imageKey),
          range: listItem(visible(row.range)),
          pricePerPersonTtc: row.pricePerPersonTtc,
          minGuests: row.minGuests,
          maxGuests: row.maxGuests,
          eventTypes: row.eventTypes.flatMap((link) =>
            visible(link.eventType) ? [link.eventType.code] : [],
          ),
          dishes: dishes(row.dishes),
        })),
        buffets: buffets.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: toLocalized(row.name),
          description: toLocalizedOrNull(row.description),
          imageUrl: image(row.imageKey),
          range: listItem(visible(row.range)),
          type: listItem(visible(row.type)),
          pricingUnit: row.pricingUnit === 'FLAT' ? 'FLAT' : 'PER_PERSON',
          priceTtc: row.priceTtc,
          minGuests: row.minGuests,
          dishes: dishes(row.dishes),
          freeItems: freeItems.safeParse(row.freeItems).data ?? [],
        })),
        equipment: equipment.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: toLocalized(row.name),
          description: toLocalizedOrNull(row.description),
          imageUrl: image(row.imageKey),
          range: listItem(visible(row.range)),
          category: listItem(visible(row.category)),
          priceTtc: row.priceTtc,
        })),
      };
    });
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async traiteur(slug: string) {
    const traiteur = await this.prisma.traiteur.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, currency: true, status: true },
    });
    if (!traiteur || UNPUBLISHED_STATUSES.has(traiteur.status)) {
      throw appErrors.notFound('TRAITEUR_NOT_FOUND', 'Traiteur introuvable');
    }
    return traiteur;
  }

  /** Réponse en cache (validée à la relecture), sinon calculée puis gardée une minute. */
  private async cached<T>(key: string, schema: z.ZodType<T>, load: () => Promise<T>): Promise<T> {
    try {
      const raw = await this.redis.get(key);
      if (raw !== null) {
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
      }
    } catch (error) {
      this.logger.warn(`Cache du catalogue public indisponible : ${String(error)}`);
    }
    const value = await load();
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Cache indisponible : la réponse est servie quand même
    }
    return value;
  }
}
