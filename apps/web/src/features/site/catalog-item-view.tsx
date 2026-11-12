'use client';

import { ArrowLeftIcon, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { MessageScreen } from '@/components/layout/message-screen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalized } from '@/features/catalog/use-localized';

import { type CartKind, perGuest } from './cart-store';
import { AddToCartButton, EntryPrice } from './catalog-card';
import { findEntry } from './catalog-view';
import { usePublicCatalog } from './site-api';

/** Fiche d'un élément du catalogue : grande photo, composition, prix TTC, ajout à la demande. */
export function CatalogItemView({ kind, id }: { kind: CartKind; id: string }) {
  const t = useTranslations('site.catalog');
  const localized = useLocalized();
  const catalog = usePublicCatalog();
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.imageUrl}
            alt={t('photoOf', { name })}
            className="aspect-[4/3] w-full rounded-xl object-cover"
          />
        ) : (
          kind !== 'service' && (
            <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-muted">
              <ImageIcon className="size-12 text-muted-foreground" aria-hidden />
            </div>
          )
        )}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1">
            {entry.range && <Badge variant="secondary">{localized(entry.range.name)}</Badge>}
            {entry.group && <Badge variant="outline">{localized(entry.group.name)}</Badge>}
          </div>
          <h1 className="text-2xl font-semibold" dir="auto">
            {name}
          </h1>
          <EntryPrice entry={entry} />
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
          <p className="text-sm text-muted-foreground">
            {t(perGuest(kind) ? 'guestsLater' : 'availabilityLater')}
          </p>
        </div>
      </div>
    </article>
  );
}
