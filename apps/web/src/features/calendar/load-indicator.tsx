'use client';

import type { CalendarDay } from '@traiteur/shared';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/** Charge d'un jour : événements confirmés / capacité, coloré quand le jour est plein. */
export function LoadIndicator({
  day,
  capacity,
  compact = false,
}: {
  day: CalendarDay;
  capacity: number | null;
  compact?: boolean;
}) {
  const t = useTranslations('calendar');
  // Dans une case du calendrier, seule la charge réelle (commandes fermes) est affichée
  if (compact && day.firmCount === 0) return null;
  const full = capacity !== null && day.firmCount >= capacity;
  const label =
    capacity === null
      ? t('loadUnlimited', { firm: day.firmCount })
      : t('loadLabel', { firm: day.firmCount, capacity });
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="day-load">
      <span
        className={cn(
          'rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
          full
            ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100'
            : 'bg-muted text-muted-foreground',
        )}
        title={label}
        aria-label={label}
        dir="ltr"
      >
        {capacity === null ? day.firmCount : t('load', { firm: day.firmCount, capacity })}
      </span>
      {!compact && day.pendingCount > 0 && (
        <span className="text-xs text-muted-foreground">
          {t('pendingCount', { count: day.pendingCount })}
        </span>
      )}
    </span>
  );
}
