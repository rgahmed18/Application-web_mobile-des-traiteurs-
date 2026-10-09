import { Injectable } from '@nestjs/common';
import {
  type Client,
  type ClientAddress,
  type ClientAddressInput,
  type ClientCreateInput,
  type ClientListQuery,
  type ClientPage,
  type ClientSummary,
  type ClientUpdateInput,
  FIRM_ORDER_STATUSES,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient;

const clientInclude = {
  user: { select: { phone: true } },
  addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
} satisfies Prisma.MembershipInclude;
type ClientRow = Prisma.MembershipGetPayload<{ include: typeof clientInclude }>;

interface ClientStats {
  orderCount: number;
  totalSpent: number;
  lastOrderAt: Date | null;
}

const EMPTY_STATS: ClientStats = { orderCount: 0, totalSpent: 0, lastOrderAt: null };

const toIso = (date: Date | null) => date?.toISOString() ?? null;

function toAddress(row: ClientRow['addresses'][number]): ClientAddress {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    city: row.city,
    isDefault: row.isDefault,
  };
}

/** Données d'audit d'une fiche client (sans le téléphone, déjà porté par le compte). */
function snapshot(row: {
  firstName: string;
  lastName: string;
  email: string | null;
  locale: string;
  tags: string[];
  internalNotes: string | null;
}): Prisma.InputJsonObject {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    locale: row.locale,
    tags: row.tags,
    internalNotes: row.internalNotes,
  };
}

/**
 * Clients du traiteur : Membership de rôle CLIENT. Les coordonnées sont celles saisies par ce
 * traiteur (Membership), jamais celles du compte global ni d'un autre traiteur.
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, query: ClientListQuery): Promise<ClientPage> {
    const traiteurId = requireTraiteurId(user);
    const where = this.listWhere(traiteurId, query);

    // Le tri par commande ou montant dépend d'agrégats : on trie les identifiants en mémoire
    // (quelques milliers de clients par traiteur au plus), puis on charge la page.
    const candidates = await this.prisma.membership.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, createdAt: true },
    });
    const stats = await this.statsFor(
      traiteurId,
      candidates.map((row) => row.id),
    );
    const direction = query.direction === 'asc' ? 1 : -1;
    const collator = new Intl.Collator('fr', { sensitivity: 'base' });
    const key = (row: (typeof candidates)[number]) => stats.get(row.id) ?? EMPTY_STATS;
    candidates.sort((a, b) => {
      let result = 0;
      if (query.sort === 'name') {
        result =
          collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName);
      } else if (query.sort === 'createdAt') {
        result = a.createdAt.getTime() - b.createdAt.getTime();
      } else if (query.sort === 'totalSpent') {
        result = key(a).totalSpent - key(b).totalSpent;
      } else {
        result = (key(a).lastOrderAt?.getTime() ?? 0) - (key(b).lastOrderAt?.getTime() ?? 0);
      }
      return result * direction || a.id.localeCompare(b.id);
    });

    const pageIds = candidates
      .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
      .map((row) => row.id);
    const rows = await this.prisma.membership.findMany({
      where: { id: { in: pageIds }, traiteurId },
      include: clientInclude,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      items: pageIds.flatMap((id) => {
        const row = byId.get(id);
        return row ? [this.toSummary(row, stats.get(id) ?? EMPTY_STATS)] : [];
      }),
      total: candidates.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(user: AuthenticatedUser, id: string): Promise<Client> {
    const traiteurId = requireTraiteurId(user);
    return this.load(this.prisma, traiteurId, id);
  }

  /**
   * Création par le traiteur. Si le numéro a déjà un compte (inscrit chez un autre traiteur ou
   * créé par un autre traiteur), ce compte est rattaché au lieu d'être dupliqué. La réponse est
   * identique dans les deux cas : rien n'est révélé de ce qui existe ailleurs.
   */
  async create(
    user: AuthenticatedUser,
    input: ClientCreateInput,
    client: ClientInfo,
  ): Promise<Client> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const account =
        (await tx.user.findUnique({ where: { phone: input.phone } })) ??
        (await tx.user.create({
          data: {
            phone: input.phone,
            // Compte sans mot de passe : le client pourra se connecter par code SMS.
            // L'email saisi par le traiteur reste sur sa fiche, pas sur le compte global.
            firstName: input.firstName,
            lastName: input.lastName,
            locale: input.locale,
          },
        }));

      const existing = await tx.membership.findUnique({
        where: { userId_traiteurId: { userId: account.id, traiteurId } },
        select: { id: true, role: true },
      });
      if (existing?.role === 'CLIENT') {
        throw appErrors.conflict(
          'CLIENT_EXISTS',
          'Ce numéro est déjà enregistré parmi vos clients',
          {
            clientId: existing.id,
          },
        );
      }
      if (existing) {
        throw appErrors.conflict(
          'PHONE_IS_STAFF',
          'Ce numéro appartient à un membre de votre équipe',
        );
      }

      const membership = await tx.membership.create({
        data: {
          traiteurId,
          userId: account.id,
          role: 'CLIENT',
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          locale: input.locale,
          tags: input.tags,
          internalNotes: input.internalNotes,
          ...(input.address
            ? // traiteurId de l'adresse : déduit de la relation composite (membershipId, traiteurId)
              { addresses: { create: { ...input.address, isDefault: true } } }
            : {}),
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'client.created',
          entityType: 'Membership',
          entityId: membership.id,
          after: snapshot(membership),
          client,
        },
        tx,
      );
      return this.load(tx, traiteurId, membership.id);
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: ClientUpdateInput,
    client: ClientInfo,
  ): Promise<Client> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findClient(tx, traiteurId, id);
      const after = await tx.membership.update({
        where: { id: before.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          locale: input.locale,
          tags: input.tags,
          internalNotes: input.internalNotes,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'client.updated',
          entityType: 'Membership',
          entityId: id,
          before: snapshot(before),
          after: snapshot(after),
          client,
        },
        tx,
      );
      return this.load(tx, traiteurId, id);
    });
  }

  async addAddress(
    user: AuthenticatedUser,
    clientId: string,
    input: ClientAddressInput,
    client: ClientInfo,
  ): Promise<Client> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      await this.findClient(tx, traiteurId, clientId);
      const count = await tx.clientAddress.count({ where: { traiteurId, membershipId: clientId } });
      const isDefault = input.isDefault || count === 0;
      if (isDefault) await this.clearDefault(tx, traiteurId, clientId);
      const address = await tx.clientAddress.create({
        data: { traiteurId, membershipId: clientId, ...input, isDefault },
      });
      await this.auditAddress(tx, user, 'client.address_added', clientId, null, address, client);
      return this.load(tx, traiteurId, clientId);
    });
  }

  async updateAddress(
    user: AuthenticatedUser,
    clientId: string,
    addressId: string,
    input: ClientAddressInput,
    client: ClientInfo,
  ): Promise<Client> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findAddress(tx, traiteurId, clientId, addressId);
      if (input.isDefault) await this.clearDefault(tx, traiteurId, clientId);
      const after = await tx.clientAddress.update({
        where: { id: addressId },
        // Une adresse par défaut le reste tant qu'une autre ne la remplace pas
        data: { ...input, isDefault: input.isDefault || before.isDefault },
      });
      await this.auditAddress(tx, user, 'client.address_updated', clientId, before, after, client);
      return this.load(tx, traiteurId, clientId);
    });
  }

  async removeAddress(
    user: AuthenticatedUser,
    clientId: string,
    addressId: string,
    client: ClientInfo,
  ): Promise<Client> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findAddress(tx, traiteurId, clientId, addressId);
      await tx.clientAddress.delete({ where: { id: addressId } });
      if (before.isDefault) {
        const next = await tx.clientAddress.findFirst({
          where: { traiteurId, membershipId: clientId },
          orderBy: { createdAt: 'asc' },
        });
        if (next)
          await tx.clientAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      await this.auditAddress(tx, user, 'client.address_removed', clientId, before, null, client);
      return this.load(tx, traiteurId, clientId);
    });
  }

  // ─────────────────────────── Interne ───────────────────────────

  private listWhere(traiteurId: string, query: ClientListQuery): Prisma.MembershipWhereInput {
    const tokens = (query.search ?? '').split(/\s+/).filter((token) => token.length > 0);
    return {
      traiteurId,
      role: 'CLIENT',
      ...(query.includeInactive ? {} : { status: 'ACTIVE' }),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      // Chaque mot doit figurer dans le prénom, le nom ou le téléphone
      AND: tokens.map((token) => {
        const digits = token.replace(/\D/g, '');
        return {
          OR: [
            { firstName: { contains: token, mode: 'insensitive' } },
            { lastName: { contains: token, mode: 'insensitive' } },
            { email: { contains: token, mode: 'insensitive' } },
            // 0612345678 et +212612345678 : on cherche les chiffres sans le zéro national
            ...(digits.length >= 3
              ? [{ user: { phone: { contains: digits.replace(/^0+/, '') } } }]
              : []),
          ],
        };
      }),
    };
  }

  /** Nombre de commandes, total dépensé et dernier événement de chaque client. */
  private async statsFor(
    traiteurId: string,
    clientIds: readonly string[],
    db: Db = this.prisma,
  ): Promise<Map<string, ClientStats>> {
    if (clientIds.length === 0) return new Map();
    const [all, firm] = await Promise.all([
      db.order.groupBy({
        by: ['clientId'],
        where: { traiteurId, clientId: { in: [...clientIds] }, status: { not: 'CANCELLED' } },
        _count: { _all: true },
        _max: { eventDate: true },
      }),
      db.order.groupBy({
        by: ['clientId'],
        where: {
          traiteurId,
          clientId: { in: [...clientIds] },
          status: { in: [...FIRM_ORDER_STATUSES] },
        },
        _sum: { totalTtc: true },
      }),
    ]);
    const spent = new Map(firm.map((row) => [row.clientId, row._sum.totalTtc ?? 0]));
    return new Map(
      all.map((row) => [
        row.clientId,
        {
          orderCount: row._count._all,
          totalSpent: spent.get(row.clientId) ?? 0,
          lastOrderAt: row._max.eventDate,
        },
      ]),
    );
  }

  private toSummary(row: ClientRow, stats: ClientStats): ClientSummary {
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.user.phone,
      email: row.email,
      locale: row.locale,
      tags: row.tags,
      active: row.status === 'ACTIVE',
      orderCount: stats.orderCount,
      totalSpent: stats.totalSpent,
      lastOrderAt: toIso(stats.lastOrderAt),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async load(db: Db, traiteurId: string, id: string): Promise<Client> {
    const row = await db.membership.findFirst({
      where: { id, traiteurId, role: 'CLIENT' },
      include: clientInclude,
    });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Client introuvable');
    const [stats, next] = await Promise.all([
      this.statsFor(traiteurId, [id], db),
      db.order.findFirst({
        where: {
          traiteurId,
          clientId: id,
          status: { notIn: ['CANCELLED', 'DRAFT'] },
          eventDate: { gte: new Date() },
        },
        orderBy: { eventDate: 'asc' },
        select: { eventDate: true },
      }),
    ]);
    return {
      ...this.toSummary(row, stats.get(id) ?? EMPTY_STATS),
      internalNotes: row.internalNotes,
      addresses: row.addresses.map(toAddress),
      nextOrderAt: toIso(next?.eventDate ?? null),
    };
  }

  private async findClient(db: Db, traiteurId: string, id: string) {
    const row = await db.membership.findFirst({ where: { id, traiteurId, role: 'CLIENT' } });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Client introuvable');
    return row;
  }

  private async findAddress(db: Db, traiteurId: string, clientId: string, addressId: string) {
    const row = await db.clientAddress.findFirst({
      where: { id: addressId, traiteurId, membershipId: clientId },
    });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Adresse introuvable');
    return row;
  }

  private async clearDefault(db: Db, traiteurId: string, clientId: string): Promise<void> {
    await db.clientAddress.updateMany({
      where: { traiteurId, membershipId: clientId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async auditAddress(
    tx: Db,
    user: AuthenticatedUser,
    action: string,
    clientId: string,
    before: ClientAddressInput | null,
    after: ClientAddressInput | null,
    client: ClientInfo,
  ): Promise<void> {
    const pick = (value: ClientAddressInput | null) =>
      value
        ? {
            label: value.label,
            address: value.address,
            city: value.city,
            isDefault: value.isDefault,
          }
        : undefined;
    await this.audit.record(
      {
        traiteurId: requireTraiteurId(user),
        actor: user,
        action,
        entityType: 'Membership',
        entityId: clientId,
        before: pick(before),
        after: pick(after),
        client,
      },
      tx,
    );
  }
}
