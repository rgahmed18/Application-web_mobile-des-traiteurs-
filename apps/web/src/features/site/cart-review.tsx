'use client';

import { ShoppingBasketIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/layout/list-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalized } from '@/features/catalog/use-localized';

import { cartStore, perGuest, useCart } from './cart-store';
import { EntryPrice } from './catalog-card';
import { type CatalogEntry, findEntry } from './catalog-view';
import { usePublicCatalog } from './site-api';

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
  const lines = cart.flatMap((item) => {
    const entry = findEntry(data, item.kind, item.id);
    return entry ? [{ entry, quantity: item.quantity }] : [];
  });
  return { lines, pending: false };
}

/** Récapitulatif de « ma demande » : quantités du matériel et des services, retrait. */
export function CartReview({ footer }: { footer?: React.ReactNode }) {
  const t = useTranslations('site.cart');
  const localized = useLocalized();
  const { lines, pending } = useCartLines();
  if (pending) return <Skeleton className="h-48 w-full" />;
  if (lines.length === 0) {
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
  return (
    <div className="flex flex-col gap-4" data-testid="cart-review">
      <ul className="flex flex-col divide-y rounded-xl border">
        {lines.map(({ entry, quantity }) => (
          <li
            key={`${entry.kind}-${entry.id}`}
            className="flex flex-wrap items-center gap-3 p-4"
            data-testid="cart-line"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase">
                {t(`kinds.${entry.kind}`)}
              </span>
              <span className="font-medium" dir="auto">
                {localized(entry.name)}
              </span>
              <EntryPrice entry={entry} />
            </div>
            {perGuest(entry.kind) ? (
              <span className="text-sm text-muted-foreground">{t('perGuestHint')}</span>
            ) : (
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
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}
