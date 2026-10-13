import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  type PermissionsMatrix,
  type PermissionsResetInput,
  type PermissionsUpdateInput,
  STAFF_ROLES,
  type StaffMemberRole,
} from '@traiteur/shared';

import { PermissionsService } from '../access/permissions.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient;

const emptyByRole = () =>
  Object.fromEntries(STAFF_ROLES.map((role) => [role, false])) as Record<StaffMemberRole, boolean>;

/** Ordre d'affichage des modules : celui du catalogue des permissions. */
const MODULE_ORDER: string[] = [...new Set(PERMISSIONS.map((permission) => permission.module))];

/**
 * Grille rôles × permissions d'un traiteur : matrice par défaut + surcharges RolePermission
 * (traiteurId renseigné). Les permissions critiques (non modifiables) ne sont jamais
 * surchargées ; les permissions du client restent hors de la grille.
 */
@Injectable()
export class RolePermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  async matrix(user: AuthenticatedUser): Promise<PermissionsMatrix> {
    return this.load(this.prisma, requireTraiteurId(user));
  }

  /** Valeur égale au défaut : la surcharge est supprimée ; sinon elle est enregistrée. */
  async update(
    user: AuthenticatedUser,
    input: PermissionsUpdateInput,
    client: ClientInfo,
  ): Promise<PermissionsMatrix> {
    const traiteurId = requireTraiteurId(user);
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, traiteurId);
      const byKey = new Map(current.permissions.map((permission) => [permission.key, permission]));
      const ids = await this.permissionIds(tx);
      const applied: { role: string; key: string; granted: boolean }[] = [];
      for (const change of input.changes) {
        const permission = byKey.get(change.key);
        const permissionId = ids.get(change.key);
        if (!permission || !permissionId) {
          throw appErrors.badRequest('VALIDATION_ERROR', `Permission inconnue : ${change.key}`);
        }
        if (!permission.editable) {
          throw appErrors.badRequest(
            'PERMISSION_NOT_EDITABLE',
            `Permission non modifiable : ${change.key}`,
          );
        }
        if (permission.granted[change.role] === change.granted) continue;
        const where = { traiteurId, role: change.role, permissionId };
        if (permission.defaults[change.role] === change.granted) {
          await tx.rolePermission.deleteMany({ where });
        } else {
          const updated = await tx.rolePermission.updateMany({
            where,
            data: { granted: change.granted },
          });
          if (updated.count === 0) {
            await tx.rolePermission.create({ data: { ...where, granted: change.granted } });
          }
        }
        applied.push(change);
      }
      if (applied.length > 0) {
        await this.audit.record(
          {
            traiteurId,
            actor: user,
            action: 'permissions.updated',
            entityType: 'Traiteur',
            entityId: traiteurId,
            after: { changes: applied },
            client,
          },
          tx,
        );
      }
      return this.load(tx, traiteurId);
    });
    await this.permissions.invalidateTenant(traiteurId);
    return result;
  }

  /** Rétablit les valeurs par défaut (tous les rôles du personnel, ou un seul). */
  async reset(
    user: AuthenticatedUser,
    input: PermissionsResetInput,
    client: ClientInfo,
  ): Promise<PermissionsMatrix> {
    const traiteurId = requireTraiteurId(user);
    const result = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.rolePermission.deleteMany({
        where: { traiteurId, role: input.role ?? { in: [...STAFF_ROLES] } },
      });
      if (count > 0) {
        await this.audit.record(
          {
            traiteurId,
            actor: user,
            action: 'permissions.reset',
            entityType: 'Traiteur',
            entityId: traiteurId,
            after: { role: input.role, removed: count },
            client,
          },
          tx,
        );
      }
      return this.load(tx, traiteurId);
    });
    await this.permissions.invalidateTenant(traiteurId);
    return result;
  }

  private async permissionIds(db: Db): Promise<Map<string, string>> {
    const rows = await db.permission.findMany({ select: { id: true, key: true } });
    return new Map(rows.map((row) => [row.key, row.id]));
  }

  private async load(db: Db, traiteurId: string): Promise<PermissionsMatrix> {
    const [permissions, rules] = await Promise.all([
      db.permission.findMany({ select: { key: true, module: true, isTenantEditable: true } }),
      db.rolePermission.findMany({
        where: {
          role: { in: [...STAFF_ROLES] },
          OR: [{ traiteurId: null }, { traiteurId }],
        },
        select: {
          traiteurId: true,
          role: true,
          granted: true,
          permission: { select: { key: true } },
        },
      }),
    ]);
    const catalogOrder = new Map<string, number>(
      PERMISSIONS.map((permission, index) => [permission.key, index]),
    );
    const rows = permissions
      // Permissions réservées aux clients (commandes et avis personnels) : hors de la grille
      .filter((permission) => {
        const definition = PERMISSIONS.find((item) => item.key === permission.key);
        return !definition || definition.defaultRoles.some((role) => role !== 'CLIENT');
      })
      .sort(
        (a, b) =>
          MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module) ||
          (catalogOrder.get(a.key) ?? 0) - (catalogOrder.get(b.key) ?? 0),
      );
    return {
      roles: [...STAFF_ROLES],
      permissions: rows.map((permission) => {
        const defaults = emptyByRole();
        const granted = emptyByRole();
        for (const rule of rules) {
          if (rule.permission.key !== permission.key || rule.traiteurId !== null) continue;
          const role = rule.role as StaffMemberRole;
          defaults[role] = rule.granted;
          granted[role] = rule.granted;
        }
        if (permission.isTenantEditable) {
          for (const rule of rules) {
            if (rule.permission.key !== permission.key || rule.traiteurId === null) continue;
            granted[rule.role as StaffMemberRole] = rule.granted;
          }
        }
        return {
          key: permission.key,
          module: permission.module,
          editable: permission.isTenantEditable,
          defaults,
          granted,
        };
      }),
    };
  }
}
