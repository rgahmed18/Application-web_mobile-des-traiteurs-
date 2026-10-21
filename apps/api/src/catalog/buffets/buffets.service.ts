import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  type Buffet,
  type BuffetInput,
  type BuffetListQuery,
  type BuffetPage,
  type CatalogListRef,
  type CatalogSettings,
  computeCatalogPrices,
  localizedTextSchema,
  resolveTaxRate,
  slugify,
} from '@traiteur/shared';
import { z } from 'zod';

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

type Db = Prisma.TransactionClient;

const listRefSelect = { id: true, code: true, name: true, archivedAt: true } as const;

const buffetInclude = {
  _count: { select: { orderItems: true, quoteLines: true } },
  type: { select: listRefSelect },
  range: { select: listRefSelect },
  dishes: {
    orderBy: { sortOrder: 'asc' },
    include: {
      dish: {
        select: {
          id: true,
          name: true,
          priceHt: true,
          priceTtc: true,
          unit: true,
          imageKey: true,
          isAvailable: true,
          archivedAt: true,
        },
      },
    },
  },
} satisfies Prisma.BuffetInclude;
type BuffetRow = Prisma.BuffetGetPayload<{ include: typeof buffetInclude }>;

const freeItemsSchema = z.array(localizedTextSchema);

function toListRef(row: {
  id: string;
  code: string;
  name: Prisma.JsonValue;
  archivedAt: Date | null;
}): CatalogListRef {
  return {
    id: row.id,
    code: row.code,
    name: toLocalized(row.name),
    archived: row.archivedAt !== null,
  };
}

function toBuffet(row: BuffetRow, settings: CatalogSettings): Buffet {
  return {
    id: row.id,
    slug: row.slug,
    name: toLocalized(row.name),
    description: toLocalizedOrNull(row.description),
    type: row.type ? toListRef(row.type) : null,
    range: row.range ? toListRef(row.range) : null,
    pricingUnit: row.pricingUnit === 'FLAT' ? 'FLAT' : 'PER_PERSON',
    priceHt: row.priceHt,
    priceTtc: row.priceTtc,
    taxRateBps: row.taxRateBps,
    effectiveTaxRateBps: resolveTaxRate(settings, row.taxRateBps),
    minGuests: row.minGuests,
    imageKey: row.imageKey,
    isActive: row.isActive,
    archivedAt: toIso(row.archivedAt),
    dishes: row.dishes.map((line) => ({
      dishId: line.dishId,
      quantity: line.quantity,
      sortOrder: line.sortOrder,
      dish: {
        id: line.dish.id,
        name: toLocalized(line.dish.name),
        priceHt: line.dish.priceHt,
        priceTtc: line.dish.priceTtc,
        unit: line.dish.unit,
        imageKey: line.dish.imageKey,
        isAvailable: line.dish.isAvailable,
        archivedAt: toIso(line.dish.archivedAt),
      },
    })),
    freeItems: freeItemsSchema.catch([]).parse(row.freeItems),
    inUse: row._count.orderItems + row._count.quoteLines > 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Buffets du catalogue : type et gamme (listes du traiteur), prix par personne ou forfait,
 * invités minimum, composition en plats (décomptés en cuisine) et en éléments libres FR/AR.
 * Un buffet ajouté à une commande ou un devis y est recopié (libellé et prix figés) : « inUse ».
 */
@Injectable()
export class BuffetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  async list(user: AuthenticatedUser, query: BuffetListQuery): Promise<BuffetPage> {
    const traiteurId = requireTraiteurId(user);
    const search = query.search?.trim();
    const where: Prisma.BuffetWhereInput = {
      traiteurId,
      archivedAt: query.archived ? { not: null } : null,
      ...(query.typeId ? { typeId: query.typeId } : {}),
      ...(query.rangeId ? { rangeId: query.rangeId } : {}),
      ...(query.status ? { isActive: query.status === 'active' } : {}),
      ...(search
        ? {
            OR: [
              { slug: { contains: slugify(search, search.toLowerCase()) } },
              { name: { path: ['fr'], string_contains: search } },
              { name: { path: ['ar'], string_contains: search } },
            ],
          }
        : {}),
    };
    const [settings, total, rows] = await Promise.all([
      loadCatalogSettings(this.prisma, traiteurId),
      this.prisma.buffet.count({ where }),
      this.prisma.buffet.findMany({
        where,
        include: buffetInclude,
        orderBy: [{ slug: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => toBuffet(row, settings)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(user: AuthenticatedUser, id: string): Promise<Buffet> {
    const traiteurId = requireTraiteurId(user);
    const [settings, row] = await Promise.all([
      loadCatalogSettings(this.prisma, traiteurId),
      this.prisma.buffet.findFirst({ where: { id, traiteurId }, include: buffetInclude }),
    ]);
    if (!row) notFound();
    return toBuffet(row, settings);
  }

  async create(user: AuthenticatedUser, input: BuffetInput, client: ClientInfo): Promise<Buffet> {
    const traiteurId = requireTraiteurId(user);
    const id = randomUUID();
    const preparedImage = input.imageKey
      ? await this.media.prepare(traiteurId, input.imageKey, id)
      : null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const settings = await loadCatalogSettings(tx, traiteurId);
        await this.assertDishes(tx, traiteurId, input, new Set());
        await this.assertLists(tx, traiteurId, input, null);
        const slug = await uniqueSlug(input.name, 'buffet', async (candidate) =>
          Boolean(
            await tx.buffet.findUnique({
              where: { traiteurId_slug: { traiteurId, slug: candidate } },
            }),
          ),
        );
        const imageKey = preparedImage
          ? await this.media.attach(tx, traiteurId, preparedImage, 'Buffet', id)
          : null;
        await tx.buffet.create({
          data: { id, traiteurId, slug, ...this.toData(input, settings), imageKey },
        });
        await this.replaceComposition(tx, traiteurId, id, input);
        const result = toBuffet(
          await tx.buffet.findUniqueOrThrow({ where: { id }, include: buffetInclude }),
          settings,
        );
        await this.audit.record(
          {
            traiteurId,
            actor: user,
            action: 'catalog.buffet.created',
            entityType: 'Buffet',
            entityId: id,
            after: auditSnapshot(result),
            client,
          },
          tx,
        );
        return result;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw appErrors.conflict('SLUG_TAKEN', 'Nom déjà utilisé');
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: BuffetInput,
    client: ClientInfo,
  ): Promise<Buffet> {
    const traiteurId = requireTraiteurId(user);
    const preparedImage = input.imageKey
      ? await this.media.prepare(traiteurId, input.imageKey, id)
      : null;
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.buffet.findFirst({
        where: { id, traiteurId },
        include: buffetInclude,
      });
      if (!existing) notFound();
      // Un plat archivé déjà présent peut rester ; un plat archivé ne peut pas être ajouté
      await this.assertDishes(
        tx,
        traiteurId,
        input,
        new Set(existing.dishes.map((line) => line.dishId)),
      );
      await this.assertLists(tx, traiteurId, input, existing);
      let imageKey = existing.imageKey;
      if (preparedImage !== existing.imageKey) {
        if (existing.imageKey) await this.media.detach(tx, traiteurId, existing.imageKey);
        imageKey = preparedImage
          ? await this.media.attach(tx, traiteurId, preparedImage, 'Buffet', id)
          : null;
      }
      await tx.buffet.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: { ...this.toData(input, settings), imageKey },
      });
      await this.replaceComposition(tx, traiteurId, id, input);
      const result = toBuffet(
        await tx.buffet.findUniqueOrThrow({ where: { id }, include: buffetInclude }),
        settings,
      );
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.buffet.updated',
          entityType: 'Buffet',
          entityId: id,
          before: auditSnapshot(toBuffet(existing, settings)),
          after: auditSnapshot(result),
          client,
        },
        tx,
      );
      return result;
    });
  }

  archive(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<Buffet> {
    return this.setArchived(user, id, new Date(), 'catalog.buffet.archived', client);
  }

  restore(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<Buffet> {
    return this.setArchived(user, id, null, 'catalog.buffet.restored', client);
  }

  async remove(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.buffet.findFirst({
        where: { id, traiteurId },
        include: buffetInclude,
      });
      if (!existing) notFound();
      if (existing.imageKey) await this.media.detach(tx, traiteurId, existing.imageKey);
      await tx.buffet.delete({ where: { id_traiteurId: { id, traiteurId } } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.buffet.deleted',
          entityType: 'Buffet',
          entityId: id,
          before: auditSnapshot(toBuffet(existing, settings)),
          client,
        },
        tx,
      );
    });
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async setArchived(
    user: AuthenticatedUser,
    id: string,
    archivedAt: Date | null,
    action: string,
    client: ClientInfo,
  ): Promise<Buffet> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.buffet.findFirst({ where: { id, traiteurId } });
      if (!existing) notFound();
      const row = await tx.buffet.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: { archivedAt },
        include: buffetInclude,
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action,
          entityType: 'Buffet',
          entityId: id,
          before: auditSnapshot({ archivedAt: toIso(existing.archivedAt) }),
          after: auditSnapshot({ archivedAt: toIso(archivedAt) }),
          client,
        },
        tx,
      );
      return toBuffet(row, settings);
    });
  }

  private toData(input: BuffetInput, settings: CatalogSettings) {
    const prices = computeCatalogPrices(
      input.price,
      settings.priceEntryMode,
      resolveTaxRate(settings, input.taxRateBps),
    );
    return {
      name: input.name,
      description: jsonOrDbNull(input.description),
      typeId: input.typeId,
      rangeId: input.rangeId,
      pricingUnit: input.pricingUnit,
      priceHt: prices.priceHt,
      priceTtc: prices.priceTtc,
      taxRateBps: input.taxRateBps,
      minGuests: input.minGuests,
      freeItems: input.freeItems,
      isActive: input.isActive,
    };
  }

  /** Les plats de la composition appartiennent au traiteur ; pas d'ajout de plat archivé. */
  private async assertDishes(
    tx: Db,
    traiteurId: string,
    input: BuffetInput,
    alreadyInBuffet: ReadonlySet<string>,
  ): Promise<void> {
    if (input.dishes.length === 0) return;
    const ids = input.dishes.map((line) => line.dishId);
    const dishes = await tx.dish.findMany({
      where: { traiteurId, id: { in: ids } },
      select: { id: true, archivedAt: true },
    });
    if (dishes.length !== new Set(ids).size) notFound();
    if (dishes.some((dish) => dish.archivedAt && !alreadyInBuffet.has(dish.id))) {
      throw appErrors.badRequest('ITEM_ARCHIVED', 'Un plat archivé ne peut pas être ajouté');
    }
  }

  /**
   * Type et gamme des listes du traiteur. Un élément archivé ou désactivé ne s'ajoute pas ;
   * celui déjà porté par le buffet peut rester.
   */
  private async assertLists(
    tx: Db,
    traiteurId: string,
    input: BuffetInput,
    existing: BuffetRow | null,
  ): Promise<void> {
    const unavailable = (row: { isActive: boolean; archivedAt: Date | null }) =>
      !row.isActive || row.archivedAt !== null;
    if (input.typeId) {
      const type = await tx.buffetType.findFirst({
        where: { id: input.typeId, traiteurId },
        select: { isActive: true, archivedAt: true },
      });
      if (!type) notFound();
      if (unavailable(type) && existing?.typeId !== input.typeId) {
        throw appErrors.badRequest('ITEM_ARCHIVED', 'Ce type de buffet n’est plus proposé');
      }
    }
    if (input.rangeId) {
      const range = await tx.catalogRange.findFirst({
        where: { id: input.rangeId, traiteurId },
        select: { isActive: true, archivedAt: true },
      });
      if (!range) notFound();
      if (unavailable(range) && existing?.rangeId !== input.rangeId) {
        throw appErrors.badRequest('ITEM_ARCHIVED', 'Cette gamme n’est plus proposée');
      }
    }
  }

  private async replaceComposition(
    tx: Db,
    traiteurId: string,
    buffetId: string,
    input: BuffetInput,
  ): Promise<void> {
    await tx.buffetDish.deleteMany({ where: { buffetId, traiteurId } });
    await tx.buffetDish.createMany({
      data: input.dishes.map((line, index) => ({
        traiteurId,
        buffetId,
        dishId: line.dishId,
        quantity: line.quantity,
        sortOrder: index,
      })),
    });
  }
}
