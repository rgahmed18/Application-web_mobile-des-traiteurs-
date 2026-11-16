'use client';

import { CheckIcon, ImageIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocalized } from '@/features/catalog/use-localized';
import { formatMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';

import { cartStore, perGuest, useCart } from './cart-store';
import type { CatalogEntry } from './catalog-view';
import { IncludedList, PublicRangeBadge } from './range-finish';
import { useListShown } from './site-lists';

/** Prix TTC et son unité : « 350,00 MAD / personne ». */
export function EntryPrice({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('site.catalog.units');
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  return (
    <span className="font-semibold" dir="auto">
      {formatMoney(entry.priceTtc, locale)}{' '}
      <span className="font-normal text-muted-foreground">{t(entry.unit)}</span>
    </span>
  );
}

/** Ajout à « ma demande » (une unité ; le nombre d'invités se règle dans la demande). */
export function AddToCartButton({
  entry,
  quantity = 1,
  className,
}: {
  entry: Pick<CatalogEntry, 'kind' | 'id'>;
  quantity?: number;
  className?: string;
}) {
  const t = useTranslations('site.catalog');
  const cart = useCart();
  const inCart = cart.some((item) => item.kind === entry.kind && item.id === entry.id);
  if (inCart && perGuest(entry.kind)) {
    return (
      <Button variant="secondary" asChild data-testid="in-cart" className={className}>
        <Link href="/demande">
          <CheckIcon data-icon="inline-start" />
          {t('inCart')}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      onClick={() => cartStore.add(entry.kind, entry.id, quantity)}
      data-testid="add-to-cart"
      className={className}
    >
      {inCart ? <CheckIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
      {inCart ? t('addAgain') : t('add')}
    </Button>
  );
}

/** Nombre de plats et d'invités : « 8 plats · de 100 à 800 invités ». */
export function EntryMeta({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('site.catalog');
  const parts = [
    entry.dishes.length > 0 ? t('dishCount', { count: entry.dishes.length }) : null,
    entry.minGuests !== null && entry.minGuests > 1
      ? entry.maxGuests
        ? t('guestsRangeShort', { min: entry.minGuests, max: entry.maxGuests })
        : t('minGuests', { count: entry.minGuests })
      : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="text-sm text-muted-foreground">{parts.join(' · ')}</p>;
}

/**
 * Carte d'un élément, à la finition de sa gamme (ivoire, bronze, or ; sobre sans gamme) : photo
 * avec badge de gamme et prix TTC posés dessus, nom, plats et invités, deux lignes de « Ce qui est
 * inclus », lien vers la fiche et ajout à la demande.
 */
export function CatalogCard({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('site.catalog');
  const localized = useLocalized();
  const shown = useListShown();
  const href = `/catalogue/${entry.kind}/${entry.id}`;
  const name = localized(entry.name);
  const range = entry.range && shown(entry.range) ? entry.range : null;
  return (
    <li
      className="range-card flex flex-col rounded-[22px] border bg-card"
      data-finish={range?.finish}
      data-testid="catalog-card"
    >
      {entry.kind !== 'service' && (
        <Link
          href={href}
          className="relative block aspect-[4/3] overflow-hidden bg-muted"
          tabIndex={-1}
        >
          {entry.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.thumbUrl}
              alt={t('photoOf', { name })}
              className="size-full object-cover transition-transform duration-700 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100"
              loading="lazy"
            />
          ) : (
            <span className="flex size-full items-center justify-center">
              <ImageIcon className="size-10 text-muted-foreground" aria-hidden />
            </span>
          )}
          {range && (
            <PublicRangeBadge
              range={range}
              className="absolute start-3 top-3 shadow-[0_4px_14px_-6px_rgb(0_0_0/0.4)]"
            />
          )}
          <span className="absolute start-3 bottom-3 rounded-2xl bg-white/95 px-3 py-1.5 text-sm text-[#2a1f1a] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.35)]">
            <EntryPrice entry={entry} />
          </span>
        </Link>
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-4 pt-3.5">
        <div className="flex flex-wrap gap-1">
          {entry.kind === 'service' && <EntryPrice entry={entry} />}
          {entry.group && shown(entry.group) && (
            <Badge variant="outline">{localized(entry.group.name)}</Badge>
          )}
        </div>
        <h3
          className={cn(
            'font-display text-[26px] leading-tight font-bold rtl:leading-normal',
            range?.finish === 'gold' && 'range-title-gold text-[30px]',
          )}
          dir="auto"
        >
          <Link href={href} className="hover:underline">
            {name}
          </Link>
        </h3>
        <EntryMeta entry={entry} />
        {range ? (
          <IncludedList range={range} limit={2} className="mt-1" />
        ) : (
          entry.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
              {localized(entry.description)}
            </p>
          )
        )}
        <div className="mt-auto flex gap-2 pt-3">
          <Button asChild variant="outline" className="h-11 flex-1 rounded-full">
            <Link href={href} aria-label={t('seeItem', { name })}>
              {t('see')}
            </Link>
          </Button>
          <AddToCartButton entry={entry} className="h-11 flex-1 rounded-full" />
        </div>
      </div>
    </li>
  );
}
