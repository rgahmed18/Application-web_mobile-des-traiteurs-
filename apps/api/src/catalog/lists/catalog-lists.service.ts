import { Injectable } from '@nestjs/common';
import {
  type CatalogList,
  catalogListCode,
  type CatalogListItem,
  type CatalogListItemInput,
  type CatalogListReorderInput,
  type LocalizedText,
} from '@traiteur/shared';

import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth-user';
import { appErrors } from '../../common/errors';
import type { ClientInfo } from '../../common/http/client-info';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  auditSnapshot,
  isUniqueViolation,
  notFound,
  requireTraiteurId,
  toLocalized,
  toLocalizedOrNull,
} from '../catalog-common';

type Db = Prisma.TransactionClient;

interface ListRow {
  id: string;
  code: string;
  name: Prisma.JsonValue;
  description: Prisma.JsonValue | null;
  sortOrder: number;
  isActive: boolean;
  archivedAt: Date | null;
}

interface ListChanges {
  name?: LocalizedText;
  description?: LocalizedText | null;
  isActive?: boolean;
  sortOrder?: number;
  archivedAt?: Date | null;
}

/** Accès à la table d'une liste ; le reste de la logique est commun. */
interface ListRepository {
  entityType: string;
  auditPrefix: string;
  /** La liste doit garder au moins un élément disponible (ex. pour créer une commande). */
  keepsOneAvailable: boolean;
  findMany(db: Db, traiteurId: string): Promise<ListRow[]>;
  findOne(db: Db, traiteurId: string, id: string): Promise<ListRow | null>;
  codeTaken(db: Db, traiteurId: string, code: string): Promise<boolean>;
  maxSortOrder(db: Db, traiteurId: string): Promise<number | null>;
  create(
    db: Db,
    data: { traiteurId: string; code: string; sortOrder: number } & Required<
      Pick<ListChanges, 'name' | 'description' | 'isActive'>
    >,
  ): Promise<ListRow>;
  update(db: Db, traiteurId: string, id: string, changes: ListChanges): Promise<ListRow>;
  delete(db: Db, traiteurId: string, id: string): Promise<void>;
  /** Utilisations par identifiant d'élément. */
  usage(db: Db, traiteurId: string, rows: ListRow[]): Promise<Map<string, number>>;
}

const listSelect = {
  id: true,
  code: true,
  name: true,
  sortOrder: true,
  isActive: true,
  archivedAt: true,
} as const;

const jsonOrNull = (value: LocalizedText | null | undefined) =>
  value === undefined ? undefined : value === null ? Prisma.DbNull : value;

const EVENT_TYPES: ListRepository = {
  entityType: 'EventType',
  auditPrefix: 'catalog.event_type',
  keepsOneAvailable: true,
  findMany: async (db, traiteurId) =>
    (
      await db.eventType.findMany({
        where: { traiteurId },
        select: listSelect,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })
    ).map((row) => ({ ...row, description: null })),
  findOne: async (db, traiteurId, id) => {
    const row = await db.eventType.findFirst({ where: { id, traiteurId }, select: listSelect });
    return row ? { ...row, description: null } : null;
  },
  codeTaken: async (db, traiteurId, code) =>
    (await db.eventType.count({ where: { traiteurId, code } })) > 0,
  maxSortOrder: async (db, traiteurId) =>
    (await db.eventType.aggregate({ where: { traiteurId }, _max: { sortOrder: true } }))._max
      .sortOrder,
  create: async (db, data) => ({
    ...(await db.eventType.create({
      data: {
        traiteurId: data.traiteurId,
        code: data.code,
        name: data.name,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      },
      select: listSelect,
    })),
    description: null,
  }),
  update: async (db, traiteurId, id, changes) => ({
    ...(await db.eventType.update({
      where: { id_traiteurId: { id, traiteurId } },
      data: {
        name: changes.name,
        isActive: changes.isActive,
        sortOrder: changes.sortOrder,
        archivedAt: changes.archivedAt,
      },
      select: listSelect,
    })),
    description: null,
  }),
  delete: async (db, traiteurId, id) => {
    await db.eventType.delete({ where: { id_traiteurId: { id, traiteurId } } });
  },
  // Commandes et menus reliés
  usage: async (db, traiteurId, rows) => {
    const [orders, packages] = await Promise.all([
      db.order.groupBy({ by: ['eventType'], where: { traiteurId }, _count: { _all: true } }),
      db.packageEventType.groupBy({
        by: ['eventTypeId'],
        where: { traiteurId },
        _count: { _all: true },
      }),
    ]);
    const byCode = new Map(orders.map((row) => [row.eventType, row._count._all]));
    const byId = new Map(packages.map((row) => [row.eventTypeId, row._count._all]));
    return new Map(
      rows.map((row) => [row.id, (byCode.get(row.code) ?? 0) + (byId.get(row.id) ?? 0)]),
    );
  },
};

const RANGES: ListRepository = {
  entityType: 'CatalogRange',
  auditPrefix: 'catalog.range',
  keepsOneAvailable: false,
  findMany: (db, traiteurId) =>
    db.catalogRange.findMany({
      where: { traiteurId },
      select: { ...listSelect, description: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  findOne: (db, traiteurId, id) =>
    db.catalogRange.findFirst({
      where: { id, traiteurId },
      select: { ...listSelect, description: true },
    }),
  codeTaken: async (db, traiteurId, code) =>
    (await db.catalogRange.count({ where: { traiteurId, code } })) > 0,
  maxSortOrder: async (db, traiteurId) =>
    (await db.catalogRange.aggregate({ where: { traiteurId }, _max: { sortOrder: true } }))._max
      .sortOrder,
  create: (db, data) =>
    db.catalogRange.create({
      data: {
        traiteurId: data.traiteurId,
        code: data.code,
        name: data.name,
        description: jsonOrNull(data.description),
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      },
      select: { ...listSelect, description: true },
    }),
  update: (db, traiteurId, id, changes) =>
    db.catalogRange.update({
      where: { id_traiteurId: { id, traiteurId } },
      data: {
        name: changes.name,
        description: jsonOrNull(changes.description),
        isActive: changes.isActive,
        sortOrder: changes.sortOrder,
        archivedAt: changes.archivedAt,
      },
      select: { ...listSelect, description: true },
    }),
  delete: async (db, traiteurId, id) => {
    await db.catalogRange.delete({ where: { id_traiteurId: { id, traiteurId } } });
  },
  // Menus et formules, matériel, buffets
  usage: async (db, traiteurId, rows) => {
    const [packages, equipment, buffets] = await Promise.all([
      db.package.groupBy({
        by: ['rangeId'],
        where: { traiteurId, rangeId: { not: null } },
        _count: { _all: true },
      }),
      db.equipmentItem.groupBy({
        by: ['rangeId'],
        where: { traiteurId, rangeId: { not: null } },
        _count: { _all: true },
      }),
      db.buffet.groupBy({
        by: ['rangeId'],
        where: { traiteurId, rangeId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const counts = new Map<string, number>();
    for (const row of [...packages, ...equipment, ...buffets]) {
      if (row.rangeId) counts.set(row.rangeId, (counts.get(row.rangeId) ?? 0) + row._count._all);
    }
    return new Map(rows.map((row) => [row.id, counts.get(row.id) ?? 0]));
  },
};

const EQUIPMENT_CATEGORIES: ListRepository = {
  entityType: 'EquipmentCategory',
  auditPrefix: 'catalog.equipment_category',
  keepsOneAvailable: false,
  findMany: async (db, traiteurId) =>
    (
      await db.equipmentCategory.findMany({
        where: { traiteurId },
        select: listSelect,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })
    ).map((row) => ({ ...row, description: null })),
  findOne: async (db, traiteurId, id) => {
    const row = await db.equipmentCategory.findFirst({
      where: { id, traiteurId },
      select: listSelect,
    });
    return row ? { ...row, description: null } : null;
  },
  codeTaken: async (db, traiteurId, code) =>
    (await db.equipmentCategory.count({ where: { traiteurId, code } })) > 0,
  maxSortOrder: async (db, traiteurId) =>
    (await db.equipmentCategory.aggregate({ where: { traiteurId }, _max: { sortOrder: true } }))
      ._max.sortOrder,
  create: async (db, data) => ({
    ...(await db.equipmentCategory.create({
      data: {
        traiteurId: data.traiteurId,
        code: data.code,
        name: data.name,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      },
      select: listSelect,
    })),
    description: null,
  }),
  update: async (db, traiteurId, id, changes) => ({
    ...(await db.equipmentCategory.update({
      where: { id_traiteurId: { id, traiteurId } },
      data: {
        name: changes.name,
        isActive: changes.isActive,
        sortOrder: changes.sortOrder,
        archivedAt: changes.archivedAt,
      },
      select: listSelect,
    })),
    description: null,
  }),
  delete: async (db, traiteurId, id) => {
    await db.equipmentCategory.delete({ where: { id_traiteurId: { id, traiteurId } } });
  },
  // Articles de matériel de la catégorie
  usage: async (db, traiteurId, rows) => {
    const items = await db.equipmentItem.groupBy({
      by: ['categoryId'],
      where: { traiteurId, categoryId: { not: null } },
      _count: { _all: true },
    });
    const byId = new Map(items.map((row) => [row.categoryId, row._count._all]));
    return new Map(rows.map((row) => [row.id, byId.get(row.id) ?? 0]));
  },
};

const BUFFET_TYPES: ListRepository = {
  entityType: 'BuffetType',
  auditPrefix: 'catalog.buffet_type',
  keepsOneAvailable: false,
  findMany: async (db, traiteurId) =>
    (
      await db.buffetType.findMany({
        where: { traiteurId },
        select: listSelect,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })
    ).map((row) => ({ ...row, description: null })),
  findOne: async (db, traiteurId, id) => {
    const row = await db.buffetType.findFirst({
      where: { id, traiteurId },
      select: listSelect,
    });
    return row ? { ...row, description: null } : null;
  },
  codeTaken: async (db, traiteurId, code) =>
    (await db.buffetType.count({ where: { traiteurId, code } })) > 0,
  maxSortOrder: async (db, traiteurId) =>
    (await db.buffetType.aggregate({ where: { traiteurId }, _max: { sortOrder: true } }))._max
      .sortOrder,
  create: async (db, data) => ({
    ...(await db.buffetType.create({
      data: {
        traiteurId: data.traiteurId,
        code: data.code,
        name: data.name,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      },
      select: listSelect,
    })),
    description: null,
  }),
  update: async (db, traiteurId, id, changes) => ({
    ...(await db.buffetType.update({
      where: { id_traiteurId: { id, traiteurId } },
      data: {
        name: changes.name,
        isActive: changes.isActive,
        sortOrder: changes.sortOrder,
        archivedAt: changes.archivedAt,
      },
      select: listSelect,
    })),
    description: null,
  }),
  delete: async (db, traiteurId, id) => {
    await db.buffetType.delete({ where: { id_traiteurId: { id, traiteurId } } });
  },
  // Buffets de ce type
  usage: async (db, traiteurId, rows) => {
    const items = await db.buffet.groupBy({
      by: ['typeId'],
      where: { traiteurId, typeId: { not: null } },
      _count: { _all: true },
    });
    const byId = new Map(items.map((row) => [row.typeId, row._count._all]));
    return new Map(rows.map((row) => [row.id, byId.get(row.id) ?? 0]));
  },
};

const REPOSITORIES: Record<CatalogList, ListRepository> = {
  'event-types': EVENT_TYPES,
  ranges: RANGES,
  'equipment-categories': EQUIPMENT_CATEGORIES,
  'buffet-types': BUFFET_TYPES,
};

function toItem(row: ListRow, usageCount: number): CatalogListItem {
  return {
    id: row.id,
    code: row.code,
    name: toLocalized(row.name),
    description: toLocalizedOrNull(row.description),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    archived: row.archivedAt !== null,
    usageCount,
  };
}

const available = (row: ListRow) => row.isActive && row.archivedAt === null;

/**
 * Listes gérables du catalogue (types d'événement, gammes) : code stable généré depuis le nom
 * français, ordre par glisser-déposer, archivage d'un élément utilisé, suppression d'un élément
 * jamais utilisé. Chaque écriture est inscrite au journal d'audit.
 */
@Injectable()
export class CatalogListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, list: CatalogList): Promise<CatalogListItem[]> {
    const traiteurId = requireTraiteurId(user);
    return this.items(this.prisma, REPOSITORIES[list], traiteurId);
  }

  async create(
    user: AuthenticatedUser,
    list: CatalogList,
    input: CatalogListItemInput,
    client: ClientInfo,
  ): Promise<CatalogListItem> {
    const traiteurId = requireTraiteurId(user);
    const repository = REPOSITORIES[list];
    try {
      return await this.prisma.$transaction(async (tx) => {
        const base = catalogListCode(input.name.fr);
        let code = base;
        for (let suffix = 2; await repository.codeTaken(tx, traiteurId, code); suffix += 1) {
          code = `${base.slice(0, 36)}_${suffix}`;
        }
        const row = await repository.create(tx, {
          traiteurId,
          code,
          name: input.name,
          description: list === 'ranges' ? input.description : null,
          isActive: input.isActive,
          sortOrder: ((await repository.maxSortOrder(tx, traiteurId)) ?? -1) + 1,
        });
        const item = toItem(row, 0);
        await this.record(tx, user, repository, 'created', row.id, null, item, client);
        return item;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw appErrors.conflict('SLUG_TAKEN', 'Nom déjà utilisé');
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    list: CatalogList,
    id: string,
    input: CatalogListItemInput,
    client: ClientInfo,
  ): Promise<CatalogListItem> {
    const traiteurId = requireTraiteurId(user);
    const repository = REPOSITORIES[list];
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.find(tx, repository, traiteurId, id);
      if (!input.isActive) await this.assertNotLast(tx, repository, traiteurId, existing);
      const row = await repository.update(tx, traiteurId, id, {
        name: input.name,
        description: list === 'ranges' ? input.description : undefined,
        isActive: input.isActive,
      });
      const usage = await repository.usage(tx, traiteurId, [row]);
      const item = toItem(row, usage.get(row.id) ?? 0);
      await this.record(
        tx,
        user,
        repository,
        'updated',
        id,
        toItem(existing, item.usageCount),
        item,
        client,
      );
      return item;
    });
  }

  /** Nouvel ordre d'affichage : uniquement des éléments de cette liste du traiteur. */
  async reorder(
    user: AuthenticatedUser,
    list: CatalogList,
    input: CatalogListReorderInput,
    client: ClientInfo,
  ): Promise<CatalogListItem[]> {
    const traiteurId = requireTraiteurId(user);
    const repository = REPOSITORIES[list];
    return this.prisma.$transaction(async (tx) => {
      const rows = await repository.findMany(tx, traiteurId);
      const known = new Set(rows.map((row) => row.id));
      if (input.ids.some((id) => !known.has(id)) || new Set(input.ids).size !== input.ids.length) {
        notFound();
      }
      for (const [position, id] of input.ids.entries()) {
        await repository.update(tx, traiteurId, id, { sortOrder: position });
      }
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: `${repository.auditPrefix}.reordered`,
          entityType: repository.entityType,
          after: auditSnapshot({ ids: input.ids }),
          client,
        },
        tx,
      );
      return this.items(tx, repository, traiteurId);
    });
  }

  /** Archivé : retiré des nouvelles saisies, conservé sur les commandes et le catalogue. */
  async setArchived(
    user: AuthenticatedUser,
    list: CatalogList,
    id: string,
    archived: boolean,
    client: ClientInfo,
  ): Promise<CatalogListItem> {
    const traiteurId = requireTraiteurId(user);
    const repository = REPOSITORIES[list];
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.find(tx, repository, traiteurId, id);
      if (archived) await this.assertNotLast(tx, repository, traiteurId, existing);
      const row = await repository.update(tx, traiteurId, id, {
        archivedAt: archived ? (existing.archivedAt ?? new Date()) : null,
      });
      const usage = await repository.usage(tx, traiteurId, [row]);
      const item = toItem(row, usage.get(row.id) ?? 0);
      await this.record(
        tx,
        user,
        repository,
        archived ? 'archived' : 'restored',
        id,
        null,
        item,
        client,
      );
      return item;
    });
  }

  /** Suppression définitive : seulement un élément jamais utilisé (sinon, l'archiver). */
  async remove(
    user: AuthenticatedUser,
    list: CatalogList,
    id: string,
    client: ClientInfo,
  ): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    const repository = REPOSITORIES[list];
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.find(tx, repository, traiteurId, id);
      const usage = await repository.usage(tx, traiteurId, [existing]);
      if ((usage.get(id) ?? 0) > 0) {
        throw appErrors.conflict('CATALOG_LIST_IN_USE', 'Élément utilisé : archivez-le plutôt');
      }
      await this.assertNotLast(tx, repository, traiteurId, existing);
      await repository.delete(tx, traiteurId, id);
      await this.record(tx, user, repository, 'deleted', id, toItem(existing, 0), null, client);
    });
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async items(
    db: Db,
    repository: ListRepository,
    traiteurId: string,
  ): Promise<CatalogListItem[]> {
    const rows = await repository.findMany(db, traiteurId);
    const usage = await repository.usage(db, traiteurId, rows);
    return rows.map((row) => toItem(row, usage.get(row.id) ?? 0));
  }

  private async find(
    db: Db,
    repository: ListRepository,
    traiteurId: string,
    id: string,
  ): Promise<ListRow> {
    const row = await repository.findOne(db, traiteurId, id);
    if (!row) notFound();
    return row;
  }

  /** Une liste qui doit rester utilisable garde au moins un élément actif et non archivé. */
  private async assertNotLast(
    db: Db,
    repository: ListRepository,
    traiteurId: string,
    target: ListRow,
  ): Promise<void> {
    if (!repository.keepsOneAvailable || !available(target)) return;
    const others = (await repository.findMany(db, traiteurId)).filter(
      (row) => row.id !== target.id && available(row),
    );
    if (others.length === 0) {
      throw appErrors.conflict(
        'CATALOG_LIST_LAST_ITEM',
        'Au moins un élément doit rester disponible dans cette liste',
      );
    }
  }

  private record(
    tx: Db,
    user: AuthenticatedUser,
    repository: ListRepository,
    verb: string,
    id: string,
    before: CatalogListItem | null,
    after: CatalogListItem | null,
    client: ClientInfo,
  ): Promise<void> {
    return this.audit.record(
      {
        traiteurId: requireTraiteurId(user),
        actor: user,
        action: `${repository.auditPrefix}.${verb}`,
        entityType: repository.entityType,
        entityId: id,
        before: before ? auditSnapshot(before) : undefined,
        after: after ? auditSnapshot(after) : undefined,
        client,
      },
      tx,
    );
  }
}
