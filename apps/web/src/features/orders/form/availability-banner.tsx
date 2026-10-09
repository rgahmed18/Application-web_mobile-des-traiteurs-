'use client';

import { isValidLocalDate } from '@traiteur/shared';
import { CalendarCheckIcon, CalendarXIcon, LoaderIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

import { useAvailability } from '../orders-api';

/** Disponibilité du jour choisi, vérifiée en direct (date bloquée, charge / capacité). */
export function AvailabilityBanner({ date, orderId }: { date: string; orderId?: string }) {
  const t = useTranslations('orders.availability');
  const valid = isValidLocalDate(date);
  const availability = useAvailability(valid ? date : null, orderId);
  if (!valid) return null;
  if (!availability.data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <LoaderIcon className="size-4 animate-spin" aria-hidden />
        {t('checking')}
      </p>
    );
  }
  const { blocked, blockedReason, full, firmCount, capacity, pendingCount } = availability.data;
  const problem = blocked || full;
  const Icon = problem ? CalendarXIcon : CalendarCheckIcon;
  return (
    <div
      role="status"
      data-testid="availability"
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3',
        problem
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
          : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-0.5">
        {blocked && (
          <p className="font-medium">{t('blocked', { reason: blockedReason ?? 'none' })}</p>
        )}
        {full ? (
          <p className="font-medium">{t('full', { firm: firmCount, capacity: capacity ?? 0 })}</p>
        ) : (
          <p>
            {capacity === null
              ? t('free', { firm: firmCount })
              : t('load', { firm: firmCount, capacity })}
          </p>
        )}
        {pendingCount > 0 && <p className="text-sm">{t('pending', { count: pendingCount })}</p>}
      </div>
    </div>
  );
}
