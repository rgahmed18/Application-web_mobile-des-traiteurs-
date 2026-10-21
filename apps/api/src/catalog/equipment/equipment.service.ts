import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  type CatalogListRef,
  type CatalogSettings,
  computeCatalogPrices,
  type Equipment,
  type EquipmentAvailability,
  type EquipmentAvailabilityQuery,
  type EquipmentInput,
  type EquipmentListQuery,
  type EquipmentPage,
  resolveTaxRate,
  slugify,
  zonedToUtc,
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
import { equipmentUsage } from './equipment-usage';

type Db = Prisma.TransactionClient;

const listRefSelect = { id: true, code: true, name: true, archivedAt: true } as const;

const equipmentInclude = {
  _count: { select: { orderItems: true, quoteLines: true } },
  category: { select: listRefSelect },
  range: { select: listRefSelect },
} satisfies Prisma.EquipmentItemInclude;
type EquipmentRow = Prisma.EquipmentItemGetPayload<{ include: typeof equipmentInclude }>;

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

function toEquipment(row: EquipmentRow, settings: CatalogSettings): Equipment {
  return {
    id: row.id,
    slug: row.slug,
    name: toLocalized(row.name),
    description: toLocalizedOrNull(row.description),
    category: row.category ? toListRef(row.category) : null,
    range: row.range ? toListRef(row.range) : null,
    priceHt: row.priceHt,
    priceTtc: row.priceTtc,
    replacementPriceHt: row.replacementPriceHt,
    replacementPriceTtc: row.replacementPriceTtc,
    taxRateBps: row.taxRateBps,
    effectiveTaxRateBps: resolveTaxRate(settings, row.taxRateBps),
    stockQuantity: row.stockQuantity,
    imageKey: row.imageKey,
    isActive: row.isActive,
    archivedAt: toIso(row.archivedAt),
    inUse: row._count.orderItems + row._count.quoteLines > 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Matériel de fête : catalogue (photo, catégorie, gamme, location, remplacement, stock) et
 * disponibilité par période. Le matériel d'une commande est occupé de son début moins le délai
 * d'installation à sa fin plus le délai de retour (réglages du traiteur, modifiables par
 * commande) ; deux réservations se gênent si leurs périodes se chevauchent.
 */
@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  async list(user: AuthenticatedUser, query: EquipmentListQuery): Promise<EquipmentPage> {
    const traiteurId = requireTraiteurId(user);
    const search = query.search?.trim();
    const where: Prisma.EquipmentItemWhereInput = {
      traiteurId,
      archivedAt: query.archived ? { not: null } : null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
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
      this.prisma.equipmentItem.count({ where }),
      this.prisma.equipmentItem.findMany({
        where,
        include: equipmentInclude,
        orderBy: [{ slug: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => toEquipment(row, settings)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(user: AuthenticatedUser, id: string): Promise<Equipment> {
    const traiteurId = requireTraiteurId(user);
    const [settings, row] = await Promise.all([
      loadCatalogSettings(this.prisma, traiteurId),
      this.prisma.equipmentItem.findFirst({ where: { id, traiteurId }, include: equipmentInclude }),
    ]);
    if (!row) notFound();
    return toEquipment(row, settings);
  }

  async create(
    user: AuthenticatedUser,
    input: EquipmentInput,
    client: ClientInfo,
  ): Promise<Equipment> {
    const traiteurId = requireTraiteurId(user);
    const id = randomUUID();
    // Copie éventuelle de la photo sur le stockage : avant la transaction, jamais pendant
    const preparedImage = input.imageKey
      ? await this.media.prepare(traiteurId, input.imageKey, id)
      : null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const settings = await loadCatalogSettings(tx, traiteurId);
        await this.assertLists(tx, traiteurId, input, null);
        const slug = await uniqueSlug(input.name, 'materiel', async (candidate) =>
          Boolean(
            await tx.equipmentItem.findUnique({
              where: { traiteurId_slug: { traiteurId, slug: candidate } },
            }),
          ),
        );
        const imageKey = preparedImage
          ? await this.media.attach(tx, traiteurId, preparedImage, 'EquipmentItem', id)
          : null;
        const row = await tx.equipmentItem.create({
          data: { id, traiteurId, slug, ...this.toData(input, settings), imageKey },
          include: equipmentInclude,
        });
        const equipment = toEquipment(row, settings);
        await this.audit.record(
          {
            traiteurId,
            actor: user,
            action: 'catalog.equipment.created',
            entityType: 'EquipmentItem',
            entityId: id,
            after: auditSnapshot(equipment),
            client,
          },
          tx,
        );
        return equipment;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw appErrors.conflict('SLUG_TAKEN', 'Nom déjà utilisé');
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: EquipmentInput,
    client: ClientInfo,
  ): Promise<Equipment> {
    const traiteurId = requireTraiteurId(user);
    const preparedImage = input.imageKey
      ? await this.media.prepare(traiteurId, input.imageKey, id)
      : null;
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.equipmentItem.findFirst({
        where: { id, traiteurId },
        include: equipmentInclude,
      });
      if (!existing) notFound();
      await this.assertLists(tx, traiteurId, input, existing);

      let imageKey = existing.imageKey;
      if (preparedImage !== existing.imageKey) {
        if (existing.imageKey) await this.media.detach(tx, traiteurId, existing.imageKey);
        imageKey = preparedImage
          ? await this.media.attach(tx, traiteurId, preparedImage, 'EquipmentItem', id)
          : null;
      }
      const row = await tx.equipmentItem.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: { ...this.toData(input, settings), imageKey },
        include: equipmentInclude,
      });
      const equipment = toEquipment(row, settings);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.equipment.updated',
          entityType: 'EquipmentItem',
          entityId: id,
          before: auditSnapshot(toEquipment(existing, settings)),
          after: auditSnapshot(equipment),
          client,
        },
        tx,
      );
      return equipment;
    });
  }

  archive(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<Equipment> {
    return this.setArchived(user, id, new Date(), 'catalog.equipment.archived', client);
  }

  restore(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<Equipment> {
    return this.setArchived(user, id, null, 'catalog.equipment.restored', client);
  }

  /** Suppression définitive, seulement si l'article n'a jamais été sur une commande. */
  async remove(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.equipmentItem.findFirst({
        where: { id, traiteurId },
        include: equipmentInclude,
      });
      if (!existing) notFound();
      if (existing._count.orderItems > 0) {
        throw appErrors.conflict('ITEM_IN_USE', 'Matériel utilisé dans une commande');
      }
      if (existing.imageKey) await this.media.detach(tx, traiteurId, existing.imageKey);
      await tx.equipmentItem.delete({ where: { id_traiteurId: { id, traiteurId } } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.equipment.deleted',
          entityType: 'EquipmentItem',
          entityId: id,
          before: auditSnapshot(toEquipment(existing, settings)),
          client,
        },
        tx,
      );
    });
  }

  /**
   * Disponibilité de chaque article sur une période (heures locales du traiteur) : stock,
   * quantités des commandes fermes dont l'occupation chevauche la période (déduites), quantités
   * des commandes en attente (affichées à part), restant.
   */
  async availability(
    user: AuthenticatedUser,
    query: EquipmentAvailabilityQuery,
  ): Promise<EquipmentAvailability> {
    const traiteurId = requireTraiteurId(user);
    const traiteur = await this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { timezone: true, equipmentSetupHours: true, equipmentReturnHours: true },
    });
    const [startDate = '', startTime = ''] = query.start.split('T');
    const [endDate = '', endTime = ''] = query.end.split('T');
    const period = {
      start: zonedToUtc(startDate, startTime, traiteur.timezone),
      end: zonedToUtc(endDate, endTime, traiteur.timezone),
    };
    const [items, usage] = await Promise.all([
      this.prisma.equipmentItem.findMany({
        where: { traiteurId, archivedAt: null },
        select: { id: true, stockQuantity: true },
        orderBy: { slug: 'asc' },
      }),
      equipmentUsage(this.prisma, traiteurId, period, traiteur, {
        excludeOrderId: query.excludeOrderId,
      }),
    ]);
    return {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      items: items.map((item) => {
        const taken = usage.reserved.get(item.id) ?? 0;
        return {
          equipmentId: item.id,
          stock: item.stockQuantity,
          reserved: taken,
          pending: usage.pending.get(item.id) ?? 0,
          remaining: item.stockQuantity - taken,
        };
      }),
    };
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async setArchived(
    user: AuthenticatedUser,
    id: string,
    archivedAt: Date | null,
    action: string,
    client: ClientInfo,
  ): Promise<Equipment> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.equipmentItem.findFirst({ where: { id, traiteurId } });
      if (!existing) notFound();
      const row = await tx.equipmentItem.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: { archivedAt },
        include: equipmentInclude,
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action,
          entityType: 'EquipmentItem',
          entityId: id,
          before: auditSnapshot({ archivedAt: toIso(existing.archivedAt) }),
          after: auditSnapshot({ archivedAt: toIso(archivedAt) }),
          client,
        },
        tx,
      );
      return toEquipment(row, settings);
    });
  }

  /** Prix saisis dans le mode du traiteur (location et remplacement) ; l'autre est dérivé. */
  private toData(input: EquipmentInput, settings: CatalogSettings) {
    const taxRate = resolveTaxRate(settings, input.taxRateBps);
    const rental = computeCatalogPrices(input.price, settings.priceEntryMode, taxRate);
    const replacement = computeCatalogPrices(
      input.replacementPrice,
      settings.priceEntryMode,
      taxRate,
    );
    return {
      name: input.name,
      description: jsonOrDbNull(input.description),
      categoryId: input.categoryId,
      rangeId: input.rangeId,
      priceHt: rental.priceHt,
      priceTtc: rental.priceTtc,
      replacementPriceHt: replacement.priceHt,
      replacementPriceTtc: replacement.priceTtc,
      taxRateBps: input.taxRateBps,
      stockQuantity: input.stockQuantity,
      isActive: input.isActive,
    };
  }

  /**
   * Catégorie et gamme des listes du traiteur. Un élément archivé ou désactivé ne s'ajoute pas ;
   * celui déjà porté par l'article peut rester.
   */
  private async assertLists(
    tx: Db,
    traiteurId: string,
    input: EquipmentInput,
    existing: EquipmentRow | null,
  ): Promise<void> {
    const unavailable = (row: { isActive: boolean; archivedAt: Date | null }) =>
      !row.isActive || row.archivedAt !== null;
    if (input.categoryId) {
      const category = await tx.equipmentCategory.findFirst({
        where: { id: input.categoryId, traiteurId },
        select: { isActive: true, archivedAt: true },
      });
      if (!category) notFound();
      if (unavailable(category) && existing?.categoryId !== input.categoryId) {
        throw appErrors.badRequest('ITEM_ARCHIVED', 'Cette catégorie n’est plus proposée');
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
}
