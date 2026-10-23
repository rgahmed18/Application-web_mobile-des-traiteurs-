import { PERMISSIONS } from '@traiteur/shared';

import type { PrismaClient } from '../generated/prisma/client';

export interface PermissionSyncResult {
  permissions: number;
  defaultGrants: number;
}

/**
 * Aligne la base sur le catalogue des permissions (packages/shared) :
 *   - crée ou met à jour chaque permission ;
 *   - supprime les permissions retirées du catalogue (et leurs droits) ;
 *   - aligne la matrice par défaut (RolePermission avec traiteurId = null), sauf les cases
 *     modifiées dans la console (editedAt) : jamais écrasées, seules les nouvelles permissions et
 *     les cases non modifiées suivent le catalogue ;
 *   - supprime les surcharges des traiteurs sur les permissions non modifiables (déjà ignorées
 *     au calcul des droits) : une permission verrouillée après coup ne garde aucune dérogation.
 * Les autres surcharges des traiteurs sont conservées. Utilisé au déploiement, par le seed et
 * les tests.
 */
export async function syncPermissionCatalog(prisma: PrismaClient): Promise<PermissionSyncResult> {
  for (const definition of PERMISSIONS) {
    const data = {
      module: definition.module,
      description: definition.description,
      isTenantEditable: definition.isTenantEditable,
    };
    await prisma.permission.upsert({
      where: { key: definition.key },
      update: data,
      create: { key: definition.key, ...data },
    });
  }
  await prisma.permission.deleteMany({
    where: { key: { notIn: PERMISSIONS.map((definition) => definition.key) } },
  });

  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));
  const desired = PERMISSIONS.flatMap((definition) =>
    definition.defaultRoles.map((role) => ({
      traiteurId: null,
      role,
      permissionId: idByKey.get(definition.key) ?? '',
      granted: true,
    })),
  );

  // Matrice par défaut : ajout des droits manquants (une case modifiée existe déjà : ignorée)…
  await prisma.rolePermission.createMany({ data: desired, skipDuplicates: true });
  // …et retrait de ceux qui ne figurent plus dans le catalogue, hors cases modifiées.
  const desiredKeys = new Set(desired.map((grant) => `${grant.role}:${grant.permissionId}`));
  const existing = await prisma.rolePermission.findMany({
    where: { traiteurId: null, editedAt: null },
    select: { id: true, role: true, permissionId: true },
  });
  const obsolete = existing.filter((row) => !desiredKeys.has(`${row.role}:${row.permissionId}`));
  if (obsolete.length > 0) {
    await prisma.rolePermission.deleteMany({
      where: { id: { in: obsolete.map((row) => row.id) } },
    });
  }
  await prisma.rolePermission.deleteMany({
    where: { traiteurId: { not: null }, permission: { isTenantEditable: false } },
  });
  return { permissions: PERMISSIONS.length, defaultGrants: desired.length };
}
