'use client';

import { CheckIcon, ImageIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocalized } from '@/features/catalog/use-localized';
import { formatMoney } from '@/lib/format/money';

import { cartStore, perGuest, useCart } from './cart-store';
import type { CatalogEntry } from './catalog-view';

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
}: {
  entry: CatalogEntry;
  quantity?: number;
}) {
  const t = useTranslations('site.catalog');
  const cart = useCart();
  const inCart = cart.some((item) => item.kind === entry.kind && item.id === entry.id);
  if (inCart && perGuest(entry.kind)) {
    return (
      <Button variant="secondary" asChild data-testid="in-cart">
        <Link href="/demande">
          <CheckIcon data-icon="inline-start" />
          {t('inCart')}
        </Link>
      </Button>
    );
  }
  return (
    <Button onClick={() => cartStore.add(entry.kind, entry.id, quantity)} data-testid="add-to-cart">
      {inCart ? <CheckIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
      {inCart ? t('addAgain') : t('add')}
    </Button>
  );
}

/** Carte d'un élément : photo, nom, gamme, prix TTC, ajout à la demande, lien vers la fiche. */
export function CatalogCard({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('site.catalog');
  const localized = useLocalized();
  const href = `/catalogue/${entry.kind}/${entry.id}`;
  const name = localized(entry.name);
  return (
    <li
      className="flex flex-col overflow-hidden rounded-xl border bg-card"
      data-testid="catalog-card"
    >
      {entry.kind !== 'service' && (
        <Link href={href} className="block aspect-[4/3] bg-muted" tabIndex={-1}>
          {entry.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.thumbUrl}
              alt={t('photoOf', { name })}
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex size-full items-center justify-center">
              <ImageIcon className="size-10 text-muted-foreground" aria-hidden />
            </span>
          )}
        </Link>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap gap-1">
          {entry.range && <Badge variant="secondary">{localized(entry.range.name)}</Badge>}
          {entry.group && <Badge variant="outline">{localized(entry.group.name)}</Badge>}
        </div>
        <h3 className="text-lg leading-snug font-semibold" dir="auto">
          <Link href={href} className="hover:underline">
            {name}
          </Link>
        </h3>
        {entry.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
            {localized(entry.description)}
          </p>
        )}
        {entry.minGuests !== null && entry.minGuests > 1 && (
          <p className="text-sm text-muted-foreground">
            {t('minGuests', { count: entry.minGuests })}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <EntryPrice entry={entry} />
          <AddToCartButton entry={entry} />
        </div>
      </div>
    </li>
  );
}
