'use client';

import { useLocale, useTranslations } from 'next-intl';

import { formatMoney } from '@/lib/format/money';

import { formatEstimate, lineEstimate } from './cart-estimate';
import { useGuests } from './cart-store';
import type { CatalogEntry } from './catalog-view';
import { GuestsInput } from './guests-input';

/**
 * Fiche d'un menu ou buffet par personne : nombre d'invités de la demande (pré-rempli), estimation
 * du total et avertissement si le nombre sort des limites prévues.
 */
export function ItemGuests({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('site.compare');
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  const guests = useGuests();
  if (entry.unit !== 'perPerson') return null;
  const total = lineEstimate(entry, 1, guests);
  const min = entry.minGuests ?? 1;
  const outOfRange =
    guests !== null && (guests < min || (entry.maxGuests !== null && guests > entry.maxGuests));
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4" data-testid="item-guests">
      <GuestsInput />
      {guests !== null && total !== null && (
        <>
          <p className="font-semibold" data-testid="item-estimate" dir="auto">
            {t('estimate', { total: formatEstimate(total, locale, formatMoney), count: guests })}
          </p>
          <p className="text-sm text-muted-foreground">{t('estimateNote')}</p>
        </>
      )}
      {outOfRange && (
        <p
          className="rounded-lg bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-900"
          data-testid="guests-warning"
        >
          {entry.maxGuests
            ? t('guestsLimits', { min, max: entry.maxGuests })
            : t('guestsMin', { min })}
        </p>
      )}
    </div>
  );
}
