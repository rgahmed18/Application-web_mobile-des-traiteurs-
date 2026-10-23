import { Injectable } from '@nestjs/common';
import {
  type PlatformAuditOptions,
  type PlatformAuditPage,
  type PlatformAuditQuery,
  zonedDayRange,
} from '@traiteur/shared';

import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PLATFORM_TIMEZONE = 'Africa/Casablanca';

/** Actions de la plateforme : super admins, commandes serveur, console. */
const PLATFORM_SCOPE: Prisma.AuditLogWhereInput = {
  OR: [
    { actorRole: 'SUPER_ADMIN' },
    { action: { startsWith: 'super_admin.' } },
    { action: { startsWith: 'platform.' } },
    { action: 'traiteur.created' },
  ],
};

/** Actions dont le motif (saisi dans la console ou en ligne de commande) peut être affiché. */
function isPlatformAction(action: string): boolean {
  return (
    action.startsWith('platform.') ||
    action.startsWith('super_admin.') ||
    action === 'traiteur.created'
  );
}

/**
 * Détail affiché : motif d'une action de la plateforme, ou requête faite chez un traiteur. Le
 * contenu des actions des traiteurs (avant/après) n'est jamais renvoyé : il peut contenir des
 * données de leurs clients.
 */
function detailOf(action: string, after: Prisma.JsonValue | null): string | null {
  if (!isPlatformAction(action) || !after || typeof after !== 'object' || Array.isArray(after)) {
    return null;
  }
  if (action === 'platform.access_request') {
    const { method, path, status } = after;
    return typeof method === 'string' && typeof path === 'string'
      ? `${method} ${path} → ${typeof status === 'number' ? status : '?'}`
      : null;
  }
  return typeof after.reason === 'string' ? after.reason : null;
}

/** Journal d'audit de la console : qui, quoi, chez quel traiteur, quand. */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PlatformAuditQuery): Promise<PlatformAuditPage> {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = zonedDayRange(query.from, PLATFORM_TIMEZONE).start;
    if (query.to) createdAt.lt = zonedDayRange(query.to, PLATFORM_TIMEZONE).end;
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        query.scope === 'platform' ? PLATFORM_SCOPE : {},
        query.actorUserId ? { actorUserId: query.actorUserId } : {},
        query.action ? { action: query.action } : {},
        query.traiteurId ? { traiteurId: query.traiteurId } : {},
        query.from || query.to ? { createdAt } : {},
      ],
    };

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          createdAt: true,
          action: true,
          actorRole: true,
          entityType: true,
          after: true,
          ipAddress: true,
          traiteur: { select: { id: true, name: true } },
          actor: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        action: row.action,
        traiteur: row.traiteur,
        actor:
          row.actor || row.actorRole
            ? {
                // Un client n'est jamais nommé dans la console
                name:
                  row.actor && row.actorRole !== 'CLIENT'
                    ? `${row.actor.firstName} ${row.actor.lastName}`.trim()
                    : null,
                role: row.actorRole,
              }
            : null,
        entityType: row.entityType,
        detail: detailOf(row.action, row.after),
        ipAddress: row.ipAddress,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async options(): Promise<PlatformAuditOptions> {
    const [actors, actions, traiteurs] = await Promise.all([
      this.prisma.user.findMany({
        where: { isSuperAdmin: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.auditLog.findMany({
        distinct: ['action'],
        orderBy: { action: 'asc' },
        select: { action: true },
      }),
      this.prisma.traiteur.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    return {
      actors: actors.map((user) => ({
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
      })),
      actions: actions.map((row) => row.action),
      traiteurs,
    };
  }
}
