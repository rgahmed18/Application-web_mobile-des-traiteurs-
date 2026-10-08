import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  type Allergen,
  allergenSchema,
  type CatalogSettings,
  computeCatalogPrices,
  type Dish,
  type DishInput,
  type DishListQuery,
  type DishPage,
  resolveTaxRate,
  slugify,
} from '@traiteur/shared';

import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth-user';
import { appErrors } from '../../common/errors';
import type { ClientInfo } from '../../common/http/client-info';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  auditSnapshot,
  isUniqueViolation,
  jsonOrDbNull,
  loadCatalogSettings,
  notFound,
  requireTraiteurId,
  toIso,
  toLocalized,
  toLocalizedOrNull,
  uniqueSlug,
} from '../catalog-common';
import { MediaService } from '../media/media.service';

export const dishInclude = {
  _count: { select: { orderItems: true, quoteLines: true } },
} satisfies Prisma.DishInclude;
export type DishRow = Prisma.DishGetPayload<{ include: typeof dishInclude }>;

/** Allergènes connus uniquement (une valeur ancienne inconnue est ignorée à l'affichage). */
function toAllergens(values: string[]): Allergen[] {
  return values.filter((value): value is Allergen => allergenSchema.safeParse(value).success);
}

export function toDish(row: DishRow, settings: CatalogSettings): Dish {
  return {
    id: row.id,
    slug: row.slug,
    name: toLocalized(row.name),
    description: toLocalizedOrNull(row.description),
    categoryId: row.categoryId,
    priceHt: row.priceHt,
    priceTtc: row.priceTtc,
    taxRateBps: row.taxRateBps,
    effectiveTaxRateBps: resolveTaxRate(settings, row.taxRateBps),
    unit: row.unit,
    minQuantity: row.minQuantity,
    allergens: toAllergens(row.allergens),
    imageKey: row.imageKey,
    isAvailable: row.isAvailable,
    archivedAt: toIso(row.archivedAt),
    inUse: row._count.orderItems + row._count.quoteLines > 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

@Injectable()
export class DishesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  async list(user: AuthenticatedUser, query: DishListQuery): Promise<DishPage> {
    const traiteurId = requireTraiteurId(user);
    const search = query.search?.trim();
    const where: Prisma.DishWhereInput = {
      traiteurId,
      archivedAt: query.archived ? { not: null } : null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.availability ? { isAvailable: query.availability === 'available' } : {}),
      ...(search
        ? {
            OR: [
              // Recherche insensible aux accents et à la casse sur l'identifiant (nom français)
              { slug: { contains: slugify(search, search.toLowerCase()) } },
              { name: { path: ['fr'], string_contains: search } },
              { name: { path: ['ar'], string_contains: search } },
            ],
          }
        : {}),
    };

    const [settings, total, rows] = await Promise.all([
      loadCatalogSettings(this.prisma, traiteurId),
      this.prisma.dish.count({ where }),
      this.prisma.dish.findMany({
        where,
        include: dishInclude,
        orderBy: [{ slug: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => toDish(row, settings)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(user: AuthenticatedUser, id: string): Promise<Dish> {
    const traiteurId = requireTraiteurId(user);
    const [settings, row] = await Promise.all([
      loadCatalogSettings(this.prisma, traiteurId),
      this.prisma.dish.findFirst({ where: { id, traiteurId }, include: dishInclude }),
    ]);
    if (!row) notFound();
    return toDish(row, settings);
  }

  async create(user: AuthenticatedUser, input: DishInput, client: ClientInfo): Promise<Dish> {
    const traiteurId = requireTraiteurId(user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const settings = await loadCatalogSettings(tx, traiteurId);
        await this.assertCategory(tx, traiteurId, input.categoryId);
        const id = randomUUID();
        const slug = await uniqueSlug(input.name, 'plat', async (candidate) =>
          Boolean(
            await tx.dish.findUnique({
              where: { traiteurId_slug: { traiteurId, slug: candidate } },
            }),
          ),
        );
        const imageKey = input.imageKey
          ? await this.media.attach(tx, traiteurId, input.imageKey, 'Dish', id)
          : null;

        const row = await tx.dish.create({
          data: { id, traiteurId, slug, ...this.toData(input, settings), imageKey },
          include: dishInclude,
        });
        const dish = toDish(row, settings);
        await this.audit.record(
          {
            traiteurId,
            actor: user,
            action: 'catalog.dish.created',
            entityType: 'Dish',
            entityId: id,
            after: auditSnapshot(dish),
            client,
          },
          tx,
        );
        return dish;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw appErrors.conflict('SLUG_TAKEN', 'Nom déjà utilisé');
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: DishInput,
    client: ClientInfo,
  ): Promise<Dish> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.dish.findFirst({ where: { id, traiteurId }, include: dishInclude });
      if (!existing) notFound();
      await this.assertCategory(tx, traiteurId, input.categoryId);

      let imageKey = existing.imageKey;
      if (input.imageKey !== existing.imageKey) {
        if (existing.imageKey) await this.media.detach(tx, traiteurId, existing.imageKey);
        imageKey = input.imageKey
          ? await this.media.attach(tx, traiteurId, input.imageKey, 'Dish', id)
          : null;
      }

      const row = await tx.dish.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: { ...this.toData(input, settings), imageKey },
        include: dishInclude,
      });
      const dish = toDish(row, settings);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.dish.updated',
          entityType: 'Dish',
          entityId: id,
          before: auditSnapshot(toDish(existing, settings)),
          after: auditSnapshot(dish),
          client,
        },
        tx,
      );
      return dish;
    });
  }

  /** Retire le plat du catalogue sans le supprimer (historique des commandes conservé). */
  archive(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<Dish> {
    return this.setArchived(user, id, new Date(), 'catalog.dish.archived', client);
  }

  restore(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<Dish> {
    return this.setArchived(user, id, null, 'catalog.dish.restored', client);
  }

  /** Suppression définitive, seulement si le plat n'a jamais servi (commande, devis, formule). */
  async remove(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.dish.findFirst({
        where: { id, traiteurId },
        include: {
          _count: { select: { orderItems: true, quoteLines: true, packageDishes: true } },
        },
      });
      if (!existing) notFound();
      if (existing._count.orderItems + existing._count.quoteLines > 0) {
        throw appErrors.conflict('ITEM_IN_USE', 'Plat utilisé dans une commande ou un devis');
      }
      if (existing._count.packageDishes > 0) {
        throw appErrors.conflict('DISH_IN_PACKAGE', 'Plat présent dans une formule');
      }
      if (existing.imageKey) await this.media.detach(tx, traiteurId, existing.imageKey);
      await tx.dish.delete({ where: { id_traiteurId: { id, traiteurId } } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.dish.deleted',
          entityType: 'Dish',
          entityId: id,
          before: auditSnapshot(
            toDish({ ...existing, _count: { orderItems: 0, quoteLines: 0 } }, settings),
          ),
          client,
        },
        tx,
      );
    });
  }

  private async setArchived(
    user: AuthenticatedUser,
    id: string,
    archivedAt: Date | null,
    action: string,
    client: ClientInfo,
  ): Promise<Dish> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.dish.findFirst({ where: { id, traiteurId } });
      if (!existing) notFound();
      const row = await tx.dish.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: { archivedAt },
        include: dishInclude,
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action,
          entityType: 'Dish',
          entityId: id,
          before: auditSnapshot({ archivedAt: toIso(existing.archivedAt) }),
          after: auditSnapshot({ archivedAt: toIso(archivedAt) }),
          client,
        },
        tx,
      );
      return toDish(row, settings);
    });
  }

  /** Colonnes calculées à partir de la saisie : le prix saisi fait foi, l'autre est dérivé. */
  private toData(input: DishInput, settings: CatalogSettings) {
    const prices = computeCatalogPrices(
      input.price,
      settings.priceEntryMode,
      resolveTaxRate(settings, input.taxRateBps),
    );
    return {
      name: input.name,
      description: jsonOrDbNull(input.description),
      categoryId: input.categoryId,
      priceHt: prices.priceHt,
      priceTtc: prices.priceTtc,
      taxRateBps: input.taxRateBps,
      unit: input.unit,
      minQuantity: input.minQuantity,
      allergens: [...new Set(input.allergens)],
      isAvailable: input.isAvailable,
    };
  }

  private async assertCategory(
    tx: Prisma.TransactionClient,
    traiteurId: string,
    categoryId: string | null,
  ): Promise<void> {
    if (!categoryId) return;
    const category = await tx.category.findFirst({ where: { id: categoryId, traiteurId } });
    if (!category) notFound();
  }
}
