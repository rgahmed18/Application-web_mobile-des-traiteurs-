import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  imageVariantPath,
  localizedTextSchema,
  parseLocalizedText,
  type PublicPhoto,
  type PublicPrivacy,
  publicPrivacySchema,
  type PublicSite,
  type PublicEventTypeCard,
  type PublicFeatured,
  DEFAULT_SITE_PALETTE,
  siteEventTypePhotoSchema,
  siteFeaturedItemSchema,
  sitePaletteSchema,
  publicSiteSchema,
  privacyPolicyVersion,
  SITE_PHOTOS_MAX,
  type PublicCatalog,
  publicCatalogOptionsSchema,
  type PublicCatalogOptions,
  type PublicCatalogQuery,
  publicCatalogSchema,
  type PublicListItem,
  type PublicRange,
  parseRangeIncluded,
  rangeFinish,
} from '@traiteur/shared';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { appErrors } from '../../common/errors';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { StorageService } from '../../storage/storage.service';
import { toLocalized, toLocalizedOrNull } from '../catalog-common';

/** Menus et buffets mis en avant sans choix du traiteur. */
const AUTO_FEATURED = 4;

/** Réponses gardées une minute : le site client peut appeler à chaque visite. */
const CACHE_TTL_SECONDS = 60;

/** Traiteur suspendu ou résilié : son catalogue n'est plus publié (404, sans le dire). */
const UNPUBLISHED_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);

/** Élément de liste publié (type d’événement, gamme…) : actif et non archivé. */
const published = { isActive: true, archivedAt: null } as const;
/** Élément du catalogue publié : disponible, non archivé et publié sur le site par le traiteur. */
const onSite = { ...published, isPublished: true } as const;
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

/** Gamme : finition et « Ce qui est inclus » en plus. */
function rangeItem(
  row: {
    code: string;
    name: Prisma.JsonValue;
    description: Prisma.JsonValue | null;
    finish: string;
    included: Prisma.JsonValue;
  } | null,
): PublicRange | null {
  const item = listItem(row);
  if (!row || !item) return null;
  return { ...item, finish: rangeFinish(row.finish), included: parseRangeIncluded(row.included) };
}

/** Champs d'une gamme publiée sur le site. */
const rangeSelect = { ...listSelect, description: true, finish: true, included: true } as const;

/**
 * Catalogue public d'un traiteur (lecture seule) pour son site client. Seuls les éléments actifs,
 * non archivés et publiés par le traiteur (« Publié sur le site ») sont montrés, avec leurs prix TTC ; ni stock, ni prix de remplacement, ni prix
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
          select: rangeSelect,
        }),
      ]);
      return {
        traiteur: { slug: traiteur.slug, name: traiteur.name },
        currency: traiteur.currency,
        eventTypes: eventTypes.flatMap((row) => listItem(row) ?? []),
        ranges: ranges.flatMap((row) => rangeItem(row) ?? []),
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

      const [menus, buffets, equipment, services] = await Promise.all([
        this.prisma.package.findMany({
          where: {
            traiteurId,
            ...onSite,
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
              select: { ...rangeSelect, isActive: true, archivedAt: true },
            },
            dishes: dishesInclude,
            eventTypes: { include: { eventType: listRef } },
          },
        }),
        this.prisma.buffet.findMany({
          where: { traiteurId, ...onSite, ...rangeFilter },
          orderBy: { slug: 'asc' },
          include: {
            type: listRef,
            range: {
              select: { ...rangeSelect, isActive: true, archivedAt: true },
            },
            dishes: dishesInclude,
          },
        }),
        this.prisma.equipmentItem.findMany({
          where: { traiteurId, ...onSite, ...rangeFilter },
          orderBy: { slug: 'asc' },
          include: {
            category: listRef,
            range: {
              select: { ...rangeSelect, isActive: true, archivedAt: true },
            },
          },
        }),
        this.prisma.extraService.findMany({
          where: { traiteurId, ...onSite },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, description: true, pricingUnit: true, priceTtc: true },
        }),
      ]);

      // Liste archivée ou désactivée : l'élément reste publié, sans cette mention
      const visible = <T extends { isActive: boolean; archivedAt: Date | null }>(row: T | null) =>
        row && row.isActive && !row.archivedAt ? row : null;
      const image = (key: string | null) => ({
        imageUrl: key ? this.photoUrl(key, 'large') : null,
        thumbUrl: key ? this.photoUrl(key, 'thumb') : null,
      });
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
          ...image(row.imageKey),
          range: rangeItem(visible(row.range)),
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
          ...image(row.imageKey),
          range: rangeItem(visible(row.range)),
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
          ...image(row.imageKey),
          range: rangeItem(visible(row.range)),
          category: listItem(visible(row.category)),
          priceTtc: row.priceTtc,
        })),
        services: services.map((row) => ({
          id: row.id,
          name: toLocalized(row.name),
          description: toLocalizedOrNull(row.description),
          pricingUnit: row.pricingUnit,
          priceTtc: row.priceTtc,
        })),
      };
    });
  }

  /**
   * Accueil du site client : présentation, contact public et photos. Sans photo choisie par le
   * traiteur, les photos des menus, buffets puis du matériel publiés.
   */
  async site(slug: string): Promise<PublicSite> {
    return this.cached(`public-site:${slug}`, publicSiteSchema, async () => {
      const { id } = await this.traiteur(slug);
      const row = await this.prisma.traiteur.findUniqueOrThrow({
        where: { id },
        select: {
          slug: true,
          name: true,
          city: true,
          phone: true,
          email: true,
          defaultLocale: true,
          siteIntro: true,
          sitePhotoKeys: true,
          requireClientApproval: true,
          sitePalette: true,
          siteWhatsappPhone: true,
          siteUpsell: true,
          siteFeatured: true,
          siteEventTypePhotos: true,
        },
      });
      const keys = row.sitePhotoKeys.length > 0 ? row.sitePhotoKeys : await this.catalogPhotos(id);
      return {
        slug: row.slug,
        name: row.name,
        city: row.city,
        phone: row.phone,
        email: row.email,
        defaultLocale: row.defaultLocale,
        intro: row.siteIntro === null ? null : parseLocalizedText(row.siteIntro),
        photos: keys.map((key): PublicPhoto => ({
          url: this.photoUrl(key, 'large'),
          thumbUrl: this.photoUrl(key, 'thumb'),
        })),
        requireClientApproval: row.requireClientApproval,
        palette: sitePaletteSchema.safeParse(row.sitePalette).data ?? DEFAULT_SITE_PALETTE,
        whatsappPhone: row.siteWhatsappPhone,
        upsell: row.siteUpsell,
        featured: await this.featured(
          id,
          z.array(siteFeaturedItemSchema).safeParse(row.siteFeatured).data ?? [],
        ),
        eventTypeCards: await this.eventTypeCards(
          id,
          z.array(siteEventTypePhotoSchema).safeParse(row.siteEventTypePhotos).data ?? [],
        ),
      };
    });
  }

  /** Politique de confidentialité : informations légales du traiteur et version à accepter. */
  async privacy(slug: string): Promise<PublicPrivacy> {
    return this.cached(`public-privacy:${slug}`, publicPrivacySchema, async () => {
      const { id } = await this.traiteur(slug);
      return this.privacyOf(id);
    });
  }

  /** Politique en vigueur d'un traiteur (sans cache) : enregistrée avec chaque consentement. */
  async privacyOf(traiteurId: string): Promise<PublicPrivacy> {
    const row = await this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: {
        name: true,
        legalName: true,
        legalForm: true,
        ice: true,
        rcNumber: true,
        rcCourt: true,
        legalAddress: true,
        city: true,
        email: true,
        phone: true,
        cndpDeclaration: true,
        privacyExtra: true,
      },
    });
    const policy = {
      controller: {
        name: row.name,
        legalName: row.legalName,
        legalForm: row.legalForm,
        ice: row.ice,
        rcNumber: row.rcNumber,
        rcCourt: row.rcCourt,
        address: row.legalAddress,
        city: row.city,
        email: row.email,
        phone: row.phone,
      },
      cndpDeclaration: row.cndpDeclaration,
      extra: row.privacyExtra === null ? null : parseLocalizedText(row.privacyExtra),
    };
    return { version: privacyPolicyVersion(policy), ...policy };
  }

  // ─────────────────────────── Interne ───────────────────────────

  private photoUrl(imageKey: string, variant: 'large' | 'thumb'): string {
    return this.storage.publicFileUrl(imageVariantPath(imageKey, variant));
  }

  private photo(key: string | null): PublicPhoto | null {
    return key ? { url: this.photoUrl(key, 'large'), thumbUrl: this.photoUrl(key, 'thumb') } : null;
  }

  /**
   * Menus et buffets mis en avant, dans l'ordre choisi, s'ils sont publiés. Sans choix du
   * traiteur : les premiers menus puis buffets publiés avec photo (4 au plus).
   */
  private async featured(
    traiteurId: string,
    chosen: { kind: 'menu' | 'buffet'; id: string }[],
  ): Promise<PublicFeatured[]> {
    const range = {
      select: { ...rangeSelect, isActive: true, archivedAt: true },
    };
    const auto = chosen.length === 0;
    const filter = (kind: 'menu' | 'buffet') =>
      auto
        ? { imageKey: { not: null } }
        : { id: { in: chosen.filter((item) => item.kind === kind).map((item) => item.id) } };
    const [menus, buffets] = await Promise.all([
      this.prisma.package.findMany({
        where: { traiteurId, ...onSite, ...filter('menu') },
        orderBy: { slug: 'asc' },
        include: { range },
        ...(auto ? { take: AUTO_FEATURED } : {}),
      }),
      this.prisma.buffet.findMany({
        where: { traiteurId, ...onSite, ...filter('buffet') },
        orderBy: { slug: 'asc' },
        include: { range },
        ...(auto ? { take: AUTO_FEATURED } : {}),
      }),
    ]);
    const visibleRange = <T extends { isActive: boolean; archivedAt: Date | null }>(
      row: T | null,
    ) => (row?.isActive && !row.archivedAt ? row : null);
    const items: PublicFeatured[] = [
      ...menus.map((row): PublicFeatured => ({
        kind: 'menu',
        id: row.id,
        name: toLocalized(row.name),
        photo: this.photo(row.imageKey),
        range: rangeItem(visibleRange(row.range)),
        priceTtc: row.pricePerPersonTtc,
        perPerson: true,
        minGuests: row.minGuests,
        maxGuests: row.maxGuests,
      })),
      ...buffets.map((row): PublicFeatured => ({
        kind: 'buffet',
        id: row.id,
        name: toLocalized(row.name),
        photo: this.photo(row.imageKey),
        range: rangeItem(visibleRange(row.range)),
        priceTtc: row.priceTtc,
        perPerson: row.pricingUnit === 'PER_PERSON',
        minGuests: row.minGuests,
        maxGuests: null,
      })),
    ];
    if (auto) return items.slice(0, AUTO_FEATURED);
    // Ordre choisi par le traiteur ; un élément retiré du site disparaît sans erreur
    return chosen.flatMap(
      (choice) => items.find((item) => item.kind === choice.kind && item.id === choice.id) ?? [],
    );
  }

  /**
   * Photo de chaque type d'événement publié : celle choisie par le traiteur, sinon celle d'un
   * menu publié proposé pour ce type, sinon celle d'un menu publié pour tous les événements.
   */
  private async eventTypeCards(
    traiteurId: string,
    own: { code: string; imageKey: string }[],
  ): Promise<PublicEventTypeCard[]> {
    const [types, menus] = await Promise.all([
      this.prisma.eventType.findMany({
        where: { traiteurId, ...published },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: { code: true },
      }),
      this.prisma.package.findMany({
        where: { traiteurId, ...onSite, imageKey: { not: null } },
        orderBy: { slug: 'asc' },
        select: {
          imageKey: true,
          eventTypes: { select: { eventType: { select: { code: true } } } },
        },
      }),
    ]);
    const forAll = menus.find((menu) => menu.eventTypes.length === 0)?.imageKey ?? null;
    return types.map(({ code }) => {
      const chosen = own.find((photo) => photo.code === code)?.imageKey;
      const menu = menus.find((row) => row.eventTypes.some((link) => link.eventType.code === code));
      return { code, photo: this.photo(chosen ?? menu?.imageKey ?? forAll) };
    });
  }

  /** Photos des éléments publiés, pour un accueil sans photo choisie. */
  private async catalogPhotos(traiteurId: string): Promise<string[]> {
    const where = { traiteurId, ...onSite, imageKey: { not: null } };
    const select = { imageKey: true } as const;
    const take = SITE_PHOTOS_MAX;
    const rows = [
      ...(await this.prisma.package.findMany({ where, select, take, orderBy: { slug: 'asc' } })),
      ...(await this.prisma.buffet.findMany({ where, select, take, orderBy: { slug: 'asc' } })),
      ...(await this.prisma.equipmentItem.findMany({
        where,
        select,
        take,
        orderBy: { slug: 'asc' },
      })),
    ];
    return rows.flatMap((row) => (row.imageKey ? [row.imageKey] : [])).slice(0, take);
  }

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
