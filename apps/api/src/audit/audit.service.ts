import { Injectable } from '@nestjs/common';
import type { AuditAction } from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import type { ClientInfo } from '../common/http/client-info';
import { normalizeIpAddress } from '../common/http/ip-address';
import { auditRequestContext } from './audit-context';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  traiteurId: string | null;
  actor: AuthenticatedUser | null; // null = action système
  /** Type d'action du registre partagé (libellé FR/AR garanti dans le back-office). */
  action: AuditAction;
  entityType: string; // ex. "Invoice"
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  client?: ClientInfo;
}

/**
 * Journal d'audit (ajout seul). Prêt à l'emploi, pas encore branché sur les modules métier.
 * Passer `tx` pour écrire l'entrée dans la même transaction que l'action auditée.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    // Requête du super admin chez un traiteur : l'événement métier suffit (voir l'intercepteur)
    const requestContext = auditRequestContext.getStore();
    if (requestContext && entry.action !== 'platform.access_request') {
      requestContext.businessEventRecorded = true;
    }
    await (tx ?? this.prisma).auditLog.create({
      data: {
        traiteurId: entry.traiteurId,
        actorUserId: entry.actor?.userId ?? null,
        actorRole: entry.actor?.role ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: entry.before,
        after: entry.after,
        ipAddress: normalizeIpAddress(entry.client?.ipAddress),
        userAgent: entry.client?.userAgent ?? null,
      },
    });
  }
}
