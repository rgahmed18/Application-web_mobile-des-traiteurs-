'use client';

import { type PermissionsMatrix, type StaffMemberRole } from '@traiteur/shared';
import { LockIcon, RotateCcwIcon, SaveIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/lib/api/use-error-message';

import type messages from '../../../messages/fr.json';
import { usePermissionsMatrix, useResetPermissions, useUpdatePermissions } from './staff-api';

type PermissionMessages = (typeof messages)['staff']['permissions'];
/** Clé de traduction d'une permission (« orders.read » → « keys.orders_read »). */
const keyLabel = (key: string) =>
  `keys.${key.replace('.', '_')}` as `keys.${keyof PermissionMessages['keys']}`;
const moduleLabel = (module: string) =>
  `modules.${module}` as `modules.${keyof PermissionMessages['modules']}`;

type Draft = Record<string, boolean>;
const cell = (role: string, key: string) => `${role}|${key}`;

/** Paires « modifier » → « consulter » : accorder la première sans la seconde est incohérent. */
const REQUIRES: Record<string, string> = {
  'catalog.write': 'catalog.read',
  'orders.write': 'orders.read',
  'orders.edit_confirmed': 'orders.write',
  'orders.cancel': 'orders.read',
  'calendar.manage': 'calendar.read',
  'quotes.manage': 'quotes.read',
  'staff.manage': 'staff.read',
  'assignments.update_own': 'assignments.read_own',
  'clients.write': 'clients.read',
  'conversations.reply': 'conversations.read',
};

/**
 * Grille rôles × permissions du personnel, groupée par module. Une case égale à la valeur
 * par défaut ne laisse aucune surcharge ; les permissions critiques sont verrouillées.
 */
export function PermissionsGrid() {
  const t = useTranslations('staff.permissions');
  const tr = useTranslations('staff.roles');
  const describeError = useErrorMessage();
  const matrix = usePermissionsMatrix();
  const update = useUpdatePermissions();
  const reset = useResetPermissions();
  const [draft, setDraft] = useState<Draft>({});
  const [resetting, setResetting] = useState<StaffMemberRole | 'all' | null>(null);

  const data = matrix.data;
  const value = (role: StaffMemberRole, permission: PermissionsMatrix['permissions'][number]) =>
    draft[cell(role, permission.key)] ?? permission.granted[role];

  const modules = useMemo(() => {
    const groups = new Map<string, PermissionsMatrix['permissions']>();
    for (const permission of data?.permissions ?? []) {
      groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission]);
    }
    return [...groups.entries()];
  }, [data]);

  if (matrix.isPending) return <Skeleton className="h-96 w-full" />;
  if (!data) return null;

  const changes = Object.entries(draft).flatMap(([id, granted]) => {
    const [role, key] = id.split('|') as [StaffMemberRole, string];
    const permission = data.permissions.find((item) => item.key === key);
    return permission && permission.granted[role] !== granted ? [{ role, key, granted }] : [];
  });
  const byKey = new Map(data.permissions.map((permission) => [permission.key, permission]));
  const warnings = data.roles.flatMap((role) =>
    Object.entries(REQUIRES).flatMap(([key, needed]) => {
      const permission = byKey.get(key);
      const required = byKey.get(needed);
      return permission && required && value(role, permission) && !value(role, required)
        ? [{ role, key, needed }]
        : [];
    }),
  );

  const save = () =>
    update.mutate(
      { changes },
      {
        onSuccess: () => {
          setDraft({});
          toast.success(t('saved'));
        },
        onError: (error) => toast.error(describeError(error)),
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t('intro')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={changes.length === 0 || update.isPending}>
          <SaveIcon aria-hidden />
          {t('save', { count: changes.length })}
        </Button>
        {changes.length > 0 && (
          <Button variant="ghost" onClick={() => setDraft({})}>
            {t('discard')}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="ms-auto">
              <RotateCcwIcon aria-hidden />
              {t('reset')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setResetting('all')}>
              {t('resetAll')}
            </DropdownMenuItem>
            {data.roles.map((role) => (
              <DropdownMenuItem key={role} onSelect={() => setResetting(role)}>
                {t('resetRole', { role: tr(`${role}.label`) })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {warnings.map((warning) => (
            <li key={`${warning.role}-${warning.key}`} className="flex items-start gap-2">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('inconsistent', {
                role: tr(`${warning.role}.label`),
                permission: t(keyLabel(warning.key)),
                needed: t(keyLabel(warning.needed)),
              })}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-sm" data-testid="permissions-grid">
          <thead className="bg-muted/60">
            <tr>
              <th className="p-3 text-start">{t('permission')}</th>
              {data.roles.map((role) => (
                <th key={role} className="w-28 p-3 text-center">
                  {tr(`${role}.label`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map(([module, permissions]) => (
              <Fragment key={module}>
                <tr className="border-t bg-muted/30">
                  <th colSpan={data.roles.length + 1} className="p-2 ps-3 text-start font-semibold">
                    {t(moduleLabel(module))}
                  </th>
                </tr>
                {permissions.map((permission) => (
                  <tr key={permission.key} className="border-t">
                    <td className="p-3">
                      <span className="flex items-center gap-2">
                        {!permission.editable && (
                          <LockIcon
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-label={t('locked')}
                          />
                        )}
                        {t(keyLabel(permission.key))}
                      </span>
                    </td>
                    {data.roles.map((role) => {
                      const checked = value(role, permission);
                      const modified = checked !== permission.defaults[role];
                      const label = `${t(keyLabel(permission.key))} — ${tr(`${role}.label`)}`;
                      return (
                        <td key={role} className="p-3 text-center">
                          <span className="inline-flex items-center gap-1">
                            <Checkbox
                              checked={checked}
                              disabled={!permission.editable || update.isPending}
                              aria-label={label}
                              data-testid={`perm-${role}-${permission.key}`}
                              onCheckedChange={(next) =>
                                setDraft((current) => ({
                                  ...current,
                                  [cell(role, permission.key)]: next === true,
                                }))
                              }
                            />
                            <span
                              className={modified ? 'size-1.5 rounded-full bg-primary' : 'size-1.5'}
                              title={modified ? t('modified') : undefined}
                              aria-hidden
                            />
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
      <p className="text-sm text-muted-foreground">{t('legend')}</p>

      <AlertDialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('resetDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {resetting === 'all' || resetting === null
                ? t('resetDialog.all')
                : t('resetDialog.role', { role: tr(`${resetting}.label`) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('resetDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                reset.mutate(resetting === 'all' || resetting === null ? null : resetting, {
                  onSuccess: () => {
                    setDraft({});
                    toast.success(t('resetDialog.done'));
                  },
                  onError: (error) => toast.error(describeError(error)),
                })
              }
            >
              {t('resetDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
