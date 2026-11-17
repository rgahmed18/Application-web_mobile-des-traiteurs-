'use client';

import { ArrowLeftIcon, ArrowRightIcon, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { MessageScreen } from '@/components/layout/message-screen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalized } from '@/features/catalog/use-localized';
import { cn } from '@/lib/utils';

import { type CartKind, perGuest } from './cart-store';
import { AddToCartButton, EntryPrice } from './catalog-card';
import { findEntry } from './catalog-view';
import { compareRanges, COMPARE_MIN_RANGES } from './range-compare';
import { IncludedPanel, PublicRangeBadge } from './range-finish';
import { usePublicCatalog, usePublicCatalogOptions } from './site-api';
import { useListShown } from './site-lists';

/** Fiche d'un élément du catalogue : grande photo, composition, prix TTC, ajout à la demande. */
export function CatalogItemView({ kind, id }: { kind: CartKind; id: string }) {
  const t = useTranslations('site.catalog');
  const localized = useLocalized();
  const shown = useListShown();
  const catalog = usePublicCatalog();
  const options = usePublicCatalogOptions();
  const [quantity, setQuantity] = useState('1');
  if (catalog.isPending) return <Skeleton className="h-96 w-full" />;
  const entry = catalog.data ? findEntry(catalog.data, kind, id) : null;
  if (!entry) {
    return (
      <MessageScreen
        icon={ImageIcon}
        title={t('notFound')}
        description={t('notFoundHint')}
        actionLabel={t('backToCatalog')}
        actionHref="/catalogue"
      />
    );
  }
  const name = localized(entry.name);
  const range = entry.range && shown(entry.range) ? entry.range : null;
  const gold = range?.finish === 'gold';
  // Comparateur : premier type d'événement du menu (ou de la liste) où deux gammes se comparent
  const compareType =
    kind === 'menu' && range && catalog.data && options.data
      ? (options.data.eventTypes
          .map((item) => item.code)
          .filter((code) => entry.eventTypes.length === 0 || entry.eventTypes.includes(code))
          .find(
            (code) =>
              compareRanges(catalog.data, options.data.ranges, code).length >= COMPARE_MIN_RANGES,
          ) ?? null)
      : null;
  const parsedQuantity = Number.parseInt(quantity, 10);

  return (
    <article className="flex flex-col gap-6" data-testid="catalog-item">
      <Button variant="link" asChild className="self-start px-0">
        <Link href={`/catalogue?onglet=${kind}`}>
          <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
          {t('backToCatalog')}
        </Link>
      </Button>
      <div className="grid gap-6 md:grid-cols-2">
        {entry.imageUrl ? (
          <div
            className={cn(
              'self-start overflow-hidden rounded-3xl',
              gold &&
                'bg-[linear-gradient(135deg,#a87a1e,#f6e2a0_30%,#c9992f_55%,#f1d98c_75%,#9c6f17)] p-[3px]',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.imageUrl}
              alt={t('photoOf', { name })}
              className={cn(
                'aspect-[4/3] w-full object-cover',
                gold ? 'rounded-[21px]' : 'rounded-3xl',
              )}
            />
          </div>
        ) : (
          kind !== 'service' && (
            <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-muted">
              <ImageIcon className="size-12 text-muted-foreground" aria-hidden />
            </div>
          )
        )}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {range && <PublicRangeBadge range={range} />}
            {entry.group && shown(entry.group) && (
              <Badge variant="outline">{localized(entry.group.name)}</Badge>
            )}
          </div>
          <h1
            className={cn(
              'font-display text-[40px] leading-tight font-bold md:text-5xl rtl:leading-normal',
              gold && 'range-title-gold',
            )}
            dir="auto"
          >
            {name}
          </h1>
          <span className="text-xl">
            <EntryPrice entry={entry} />
          </span>
          {entry.description && (
            <p className="leading-relaxed whitespace-pre-line" dir="auto">
              {localized(entry.description)}
            </p>
          )}
          {(entry.minGuests ?? 0) > 1 && (
            <p className="text-muted-foreground">
              {entry.maxGuests
                ? t('guestsRange', { min: entry.minGuests ?? 1, max: entry.maxGuests })
                : t('minGuests', { count: entry.minGuests ?? 1 })}
            </p>
          )}
          {entry.dishes.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-semibold">{t('composition')}</h2>
              <ul className="list-inside list-disc" dir="auto">
                {entry.dishes.map((dish, index) => (
                  <li key={index}>
                    {dish.quantity > 1 ? `${dish.quantity} × ` : ''}
                    {localized(dish.name)}
                  </li>
                ))}
                {entry.freeItems.map((item, index) => (
                  <li key={`free-${index}`}>{localized(item)}</li>
                ))}
              </ul>
            </section>
          )}
          {range && <IncludedPanel range={range} />}
          <div className="flex flex-wrap items-end gap-3">
            {!perGuest(kind) && (
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('quantity')}
                <Input
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  className="w-24"
                />
              </label>
            )}
            <AddToCartButton
              entry={entry}
              quantity={Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1}
            />
          </div>
          {compareType && (
            <Button variant="link" asChild className="self-start px-0 text-base font-bold">
              <Link href={`/catalogue/comparer?type=${compareType}`} data-testid="compare-link">
                {t('compareRanges')}
                <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
              </Link>
            </Button>
          )}
          <p className="text-sm text-muted-foreground">
            {t(perGuest(kind) ? 'guestsLater' : 'availabilityLater')}
          </p>
        </div>
      </div>
    </article>
  );
}
