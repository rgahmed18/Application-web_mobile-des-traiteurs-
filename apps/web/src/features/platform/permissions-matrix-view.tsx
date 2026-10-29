'use client';

import {
  type PermissionKey,
  permissionInconsistencies,
  type PlatformPermissionMatrix,
  type TenantRole,
} from '@traiteur/shared';
import { LockIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { LoadError } from '@/components/layout/load-error';
import { PageHeader } from '@/components/layout/page-header';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/lib/api/use-error-message';

import { usePlatformPermissions, useSetPlatformPermission } from './platform-api';

type MatrixPermission = PlatformPermissionMatrix['permissions'][number];

/** Permission absente de la matrice (catalogue en retard sur la base) : libellé par sa clé. */
const fallback = (key: PermissionKey): MatrixPermission => ({
  key,
  module: '',
  description: key,
  isTenantEditable: true,
  cells: {} as MatrixPermission['cells'],
});

/**
 * Matrice des permissions par défaut, pour tous les traiteurs : chaque case prend effet tout de
 * suite. Une case différente du catalogue est signalée ; elle est conservée lors des mises à jour
 * de l'application. Les traiteurs ajustent ensuite la leur, hors permissions critiques.
 */
export function PermissionsMatrixView() {
  const t = useTranslations('platform.permissions');
  const tp = useTranslations('staff.permissions');
  const describeError = useErrorMessage();
  const matrix = usePlatformPermissions();
  const save = useSetPlatformPermission();
  const [pendingCell, setPendingCell] = useState<string | null>(null);

  const modules = useMemo(() => {
    const groups = new Map<string, MatrixPermission[]>();
    for (const permission of matrix.data?.permissions ?? []) {
      groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission]);
    }
    return [...groups.entries()];
  }, [matrix.data]);

  if (matrix.isPending) return <Skeleton className="h-96 w-full" />;
  if (!matrix.data) return <LoadError error={matrix.error} backHref="/platform" />;
  const roles = matrix.data.roles;

  // Libellés traduits de la grille des traiteurs ; à défaut, description du catalogue
  const permissionLabel = (permission: MatrixPermission) => {
    const key = `keys.${permission.key.replace('.', '_')}` as 'keys.catalog_read';
    return tp.has(key) ? tp(key) : permission.description;
  };
  const moduleLabel = (module: string) => {
    const key = `modules.${module}` as 'modules.catalog';
    return tp.has(key) ? tp(key) : module;
  };
  const roleLabel = (role: TenantRole) => t(`roles.${role}`);
  // Droit d'agir sans le droit de consulter qu'il suppose (ex. enregistrer sans consulter)
  const cells = new Map(matrix.data.permissions.map((permission) => [permission.key, permission]));
  const warnings = roles.flatMap((role) =>
    permissionInconsistencies((key) => cells.get(key)?.cells[role].granted ?? false).map(
      ({ key, needed }) => ({ role, key, needed }),
    ),
  );
  const editedCount = matrix.data.permissions.reduce(
    (count, permission) =>
      count +
      roles.filter(
        (role) => permission.cells[role].granted !== permission.cells[role].catalogDefault,
      ).length,
    0,
  );

  const toggle = (permission: MatrixPermission, role: TenantRole, granted: boolean) => {
    const id = `${role}|${permission.key}`;
    setPendingCell(id);
    save.mutate(
      { role, key: permission.key, granted },
      {
        onSuccess: () =>
          toast.success(
            t(granted ? 'granted' : 'revoked', {
              permission: permissionLabel(permission),
              role: roleLabel(role),
            }),
          ),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setPendingCell(null),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <div className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <p>{t('warning')}</p>
        <p>{t('legend')}</p>
      </div>
      {warnings.length > 0 && (
        <ul
          className="flex flex-col gap-1 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
          data-testid="permissions-inconsistencies"
        >
          {warnings.map((warning) => (
            <li key={`${warning.role}-${warning.key}`} className="flex items-start gap-2">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('inconsistent', {
                role: roleLabel(warning.role),
                permission: permissionLabel(cells.get(warning.key) ?? fallback(warning.key)),
                needed: permissionLabel(cells.get(warning.needed) ?? fallback(warning.needed)),
              })}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground" data-testid="permissions-edited-count">
        {t('editedCount', { count: editedCount })}
      </p>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[44rem] text-sm" data-testid="platform-permissions">
          <thead className="bg-muted/60">
            <tr>
              <th className="p-3 text-start">{t('permission')}</th>
              {roles.map((role) => (
                <th key={role} className="w-28 p-3 text-center">
                  {roleLabel(role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map(([module, permissions]) => (
              <Fragment key={module}>
                <tr className="border-t bg-muted/30">
                  <th colSpan={roles.length + 1} className="p-2 ps-3 text-start font-semibold">
                    {moduleLabel(module)}
                  </th>
                </tr>
                {permissions.map((permission) => (
                  <tr key={permission.key} className="border-t">
                    <td className="p-3">
                      <span className="flex items-center gap-2">
                        {!permission.isTenantEditable && (
                          <LockIcon
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-label={t('critical')}
                          />
                        )}
                        {permissionLabel(permission)}
                      </span>
                    </td>
                    {roles.map((role) => {
                      const { granted, catalogDefault } = permission.cells[role];
                      const edited = granted !== catalogDefault;
                      return (
                        <td key={role} className="p-3 text-center">
                          <span className="relative inline-flex items-center">
                            <Checkbox
                              checked={granted}
                              disabled={pendingCell !== null}
                              aria-label={`${permissionLabel(permission)} — ${roleLabel(role)}`}
                              onCheckedChange={(checked) =>
                                toggle(permission, role, checked === true)
                              }
                            />
                            {edited && (
                              <span
                                className="absolute -end-2.5 -top-1.5 size-2 rounded-full bg-amber-500"
                                title={t(catalogDefault ? 'editedOff' : 'editedOn')}
                                data-testid="permission-edited"
                              />
                            )}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
