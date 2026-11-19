'use client';

import type { PublicRange } from '@traiteur/shared';
import { ShoppingBasketIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { EmptyState } from '@/components/layout/list-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalized } from '@/features/catalog/use-localized';
import { formatMoney } from '@/lib/format/money';

import {
  alternativeGroups,
  cartEstimate,
  formatEstimate,
  formatEstimateAmount,
  lineEstimate,
} from './cart-estimate';
import { cartStore, isCatalogItem, perGuest, useCart, useGuests } from './cart-store';
import { EntryPrice } from './catalog-card';
import { type CatalogEntry, findEntry } from './catalog-view';
import { GuestsInput } from './guests-input';
import { RangeMark } from './range-finish';
import { usePublicCatalog, usePublicCatalogOptions } from './site-api';
import { UpgradeSuggestion } from './upgrade-suggestion';

/** Ligne de « ma demande » : élément encore publié, avec sa quantité choisie. */
export interface CartLine {
  entry: CatalogEntry;
  quantity: number;
}

/** Éléments de « ma demande » encore publiés (un élément retiré du catalogue disparaît). */
export function useCartLines(): { lines: CartLine[]; pending: boolean } {
  const cart = useCart();
  const catalog = usePublicCatalog();
  if (!catalog.data) return { lines: [], pending: catalog.isPending };
  const data = catalog.data;
  const lines = cart.filter(isCatalogItem).flatMap((item) => {
    const entry = findEntry(data, item.kind, item.id);
    return entry ? [{ entry, quantity: item.quantity }] : [];
  });
  return { lines, pending: false };
}

/** Gammes demandées « sur demande » encore publiées (codes de « Ma demande »). */
export function useCartRanges(): PublicRange[] {
  const cart = useCart();
  const options = usePublicCatalogOptions();
  const ranges = options.data?.ranges ?? [];
  return cart.flatMap((item) =>
    item.kind === 'range' ? ranges.filter((range) => range.code === item.id) : [],
  );
}

/** Montants de « Ma demande » : prix exact, estimation arrondie. */
function useAmounts() {
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  return {
    price: (cents: number) => formatMoney(cents, locale),
    estimate: (cents: number) => formatEstimate(cents, locale, formatMoney),
    /** Début d'une fourchette, sans devise. */
    bare: (cents: number) => formatEstimateAmount(cents, locale, formatMoney),
  };
}

/** Prix et estimation d'une ligne : « 280,00 MAD / pers. × 150 invités = env. 42 000 MAD ». */
function LineAmount({
  entry,
  quantity,
  guests,
}: {
  entry: CatalogEntry;
  quantity: number;
  guests: number | null;
}) {
  const t = useTranslations('site.cart');
  const amounts = useAmounts();
  const total = lineEstimate(entry, quantity, guests);
  if (entry.unit === 'perPerson') {
    return guests === null || total === null ? (
      <span className="text-sm text-muted-foreground" data-testid="line-amount">
        <EntryPrice entry={entry} /> · {t('guestsMissing')}
      </span>
    ) : (
      <span className="text-sm" data-testid="line-amount" dir="auto">
        {t('perPersonLine', {
          price: amounts.price(entry.priceTtc),
          count: guests,
          total: amounts.estimate(total),
        })}
      </span>
    );
  }
  if (entry.unit === 'flat' || total === null) return <EntryPrice entry={entry} />;
  return (
    <span className="text-sm" data-testid="line-amount" dir="auto">
      <EntryPrice entry={entry} />
      {quantity > 1 && ` × ${quantity} = ${t('about', { total: amounts.estimate(total) })}`}
    </span>
  );
}

/**
 * Récapitulatif de « Ma demande » : nombre d'invités de la demande (le même partout sur le
 * site), lignes avec leur estimation (par personne × invités, quantités du matériel et des
 * services), gammes « sur demande », total estimé ; note si plusieurs formules visent le même
 * événement. `guestsField` : champ du nombre d'invités en tête (absent dans l'assistant, qui a
 * le sien).
 */
export function CartReview({
  footer,
  guestsField = true,
}: {
  footer?: React.ReactNode;
  guestsField?: boolean;
}) {
  const t = useTranslations('site.cart');
  const localized = useLocalized();
  const amounts = useAmounts();
  const guests = useGuests();
  const catalog = usePublicCatalog();
  const { lines, pending } = useCartLines();
  const ranges = useCartRanges();
  if (pending) return <Skeleton className="h-48 w-full" />;
  if (lines.length === 0 && ranges.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBasketIcon}
        title={t('empty')}
        description={t('emptyHint')}
        action={
          <Button asChild>
            <Link href="/catalogue">{t('browse')}</Link>
          </Button>
        }
      />
    );
  }
  const menus = (catalog.data?.menus ?? []).filter((menu) =>
    lines.some((line) => line.entry.kind === 'menu' && line.entry.id === menu.id),
  );
  // Formules d'un même événement : alternatives (le client n'en prendra qu'une)
  const groups = alternativeGroups(menus);
  const options = new Set(groups.flat());
  const total = cartEstimate(lines, guests, groups);
  return (
    <div className="flex flex-col gap-4" data-testid="cart-review">
      {guestsField && (
        <div className="rounded-xl border bg-card p-4">
          <GuestsInput />
        </div>
      )}
      {groups.length > 0 && (
        <p
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="hesitation-note"
        >
          {t('hesitating')}
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-xl border">
        {lines.map(({ entry, quantity }) => (
          <li
            key={`${entry.kind}-${entry.id}`}
            className="flex flex-wrap items-center gap-3 p-4"
            data-testid="cart-line"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
                {t(`kinds.${entry.kind}`)}
                {entry.kind === 'menu' && options.has(entry.id) && (
                  <span
                    className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-bold text-amber-900 normal-case"
                    data-testid="option-badge"
                  >
                    {t('option')}
                  </span>
                )}
              </span>
              <span className="font-medium" dir="auto">
                {localized(entry.name)}
              </span>
              <LineAmount entry={entry} quantity={quantity} guests={guests} />
            </div>
            {!perGuest(entry.kind) && (
              <label className="flex items-center gap-2 text-sm">
                {t('quantity')}
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(event) =>
                    cartStore.setQuantity(entry.kind, entry.id, Number(event.target.value) || 1)
                  }
                  className="w-24"
                  dir="ltr"
                  aria-label={t('quantityOf', { name: localized(entry.name) })}
                />
              </label>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => cartStore.remove(entry.kind, entry.id)}
              aria-label={t('remove', { name: localized(entry.name) })}
            >
              <Trash2Icon aria-hidden />
            </Button>
            {entry.kind === 'menu' && <UpgradeSuggestion entry={entry} />}
          </li>
        ))}
        {ranges.map((range) => (
          <li
            key={`range-${range.code}`}
            className="flex flex-wrap items-center gap-3 p-4"
            data-testid="cart-range-line"
          >
            <RangeMark finish={range.finish} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase">{t('kinds.range')}</span>
              <span className="font-medium" dir="auto">
                {t('rangeOnRequest', { name: localized(range.name) })}
              </span>
              <span className="text-sm text-muted-foreground">{t('rangeOnRequestHint')}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => cartStore.remove('range', range.code)}
              aria-label={t('remove', { name: localized(range.name) })}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {lines.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border bg-card p-4" data-testid="cart-total">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-bold">{t('totalLabel')}</span>
            <span className="text-xl font-extrabold" dir="auto">
              {total === null
                ? t('totalPending')
                : total.min === total.max
                  ? t('about', { total: amounts.estimate(total.min) })
                  : t('between', {
                      min: amounts.bare(total.min),
                      max: amounts.estimate(total.max),
                    })}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {ranges.length > 0 ? t('totalNoteRanges') : t('totalNote')}
          </p>
        </div>
      )}
      {footer}
    </div>
  );
}
