import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  PLATFORM_MATRIX_ROLES,
  type PlatformPermissionMatrix,
  type TenantRole,
} from '@traiteur/shared';

import { PermissionsService } from '../access/permissions.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { PrismaService } from '../prisma/prisma.service';

type MatrixRole = (typeof PLATFORM_MATRIX_ROLES)[number];

/**
 * Matrice des permissions par défaut (tous les traiteurs), modifiable dans la console. Une case
 * différente du catalogue est marquée (editedAt) : la synchronisation du catalogue au
 * déploiement ne la touche plus. Une case remise à la valeur du catalogue le suit de nouveau.
 */
@Injectable()
export class PlatformPermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async matrix(): Promise<PlatformPermissionMatrix> {
    const [stored, rules] = await Promise.all([
      this.prisma.permission.findMany({
        select: { key: true, module: true, description: true, isTenantEditable: true },
      }),
      this.prisma.rolePermission.findMany({
        where: { traiteurId: null },
        select: { role: true, granted: true, permission: { select: { key: true } } },
      }),
    ]);
    const granted = new Set(
      rules.filter((rule) => rule.granted).map((rule) => `${rule.role}|${rule.permission.key}`),
    );
    const byKey = new Map(stored.map((permission) => [permission.key, permission]));
    return {
      roles: [...PLATFORM_MATRIX_ROLES],
      // Ordre du catalogue (modules regroupés)
      permissions: PERMISSIONS.flatMap((definition) => {
        const permission = byKey.get(definition.key);
        if (!permission) return [];
        const cells = Object.fromEntries(
          PLATFORM_MATRIX_ROLES.map((role) => [
            role,
            {
              granted: granted.has(`${role}|${definition.key}`),
              catalogDefault: (definition.defaultRoles as readonly TenantRole[]).includes(role),
            },
          ]),
        ) as PlatformPermissionMatrix['permissions'][number]['cells'];
        return [
          {
            key: permission.key,
            module: permission.module,
            description: permission.description,
            isTenantEditable: permission.isTenantEditable,
            cells,
          },
        ];
      }),
    };
  }

  /** Accorde ou retire une permission à un rôle, pour tous les traiteurs (sauf leurs surcharges). */
  async setDefault(
    user: AuthenticatedUser,
    key: string,
    role: MatrixRole,
    granted: boolean,
    client: ClientInfo,
  ): Promise<PlatformPermissionMatrix> {
    const definition = PERMISSIONS.find((item) => item.key === key);
    const permission = definition
      ? await this.prisma.permission.findUnique({ where: { key }, select: { id: true } })
      : null;
    if (!definition || !permission) {
      throw appErrors.notFound('PERMISSION_NOT_FOUND', 'Permission introuvable');
    }
    const catalogDefault = (definition.defaultRoles as readonly TenantRole[]).includes(role);

    const changed = await this.prisma.$transaction(async (tx) => {
      const current = await tx.rolePermission.findFirst({
        where: { traiteurId: null, role, permissionId: permission.id },
        select: { id: true, granted: true },
      });
      const before = current?.granted ?? false;
      if (granted === catalogDefault) {
        // Valeur du catalogue : case non marquée (accordée) ou absente (retirée)
        if (granted) {
          if (current) {
            await tx.rolePermission.update({
              where: { id: current.id },
              data: { granted: true, editedAt: null },
            });
          } else {
            await tx.rolePermission.create({
              data: { traiteurId: null, role, permissionId: permission.id, granted: true },
            });
          }
        } else if (current) {
          await tx.rolePermission.delete({ where: { id: current.id } });
        }
      } else if (current) {
        await tx.rolePermission.update({
          where: { id: current.id },
          data: { granted, editedAt: new Date() },
        });
      } else {
        await tx.rolePermission.create({
          data: {
            traiteurId: null,
            role,
            permissionId: permission.id,
            granted,
            editedAt: new Date(),
          },
        });
      }
      if (before === granted) return false;
      await this.audit.record(
        {
          traiteurId: null,
          actor: user,
          action: 'platform.permission_default_changed',
          entityType: 'Permission',
          entityId: permission.id,
          before: { key, role, granted: before },
          after: { key, role, granted, catalogDefault },
          client,
        },
        tx,
      );
      return true;
    });
    if (changed) await this.permissions.invalidateAll();
    return this.matrix();
  }
}
