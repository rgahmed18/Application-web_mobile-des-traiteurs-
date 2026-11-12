'use client';

import type { ClientAccount } from '@traiteur/shared';
import { ClockIcon, OctagonXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useSpace } from '@/features/space/space-provider';

/**
 * Compte pas encore accepté par le traiteur (réglage « Validation des nouveaux clients ») : le
 * client voit son espace, mais ne peut pas envoyer de demande. Refusé : le motif du traiteur.
 */
export function ApprovalNotice({ account }: { account: ClientAccount }) {
  const t = useTranslations('site.approval');
  const space = useSpace();
  const traiteur = space?.kind === 'traiteur' ? space.traiteur.name : '';
  if (account.approval === 'APPROVED') return null;
  const pending = account.approval === 'PENDING';
  return (
    <div
      role="status"
      data-testid="approval-notice"
      className={
        pending
          ? 'flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
          : 'flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4'
      }
    >
      {pending ? (
        <ClockIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
      ) : (
        <OctagonXIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      )}
      <div className="flex flex-col gap-1">
        <p className="font-medium">{t(pending ? 'pendingTitle' : 'rejectedTitle', { traiteur })}</p>
        <p className="text-sm" dir="auto">
          {pending
            ? t('pendingBody')
            : t('rejectedBody', { reason: account.rejectionReason ?? '' })}
        </p>
      </div>
    </div>
  );
}
