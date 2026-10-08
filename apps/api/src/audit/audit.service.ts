import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth-user';
import type { ClientInfo } from '../common/http/client-info';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  traiteurId: string | null;
  actor: AuthenticatedUser | null; // null = action système
  action: string; // ex. "invoice.issued"
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
        ipAddress: entry.client?.ipAddress ?? null,
        userAgent: entry.client?.userAgent ?? null,
      },
    });
  }
}
