'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatMoney } from '@/lib/format/money';

/**
 * Seuils au-delà desquels un prix du catalogue paraît inhabituel (centimes) : une saisie
 * doublée (« 10 » devenu « 1010 ») est confirmée avant d'être enregistrée.
 */
export const UNUSUAL_PRICE_CENTS = {
  /** Prix à l'unité, par personne, par heure, au kilo : 10 000 MAD. */
  unit: 1_000_000,
  /** Forfait (buffet, service) : 200 000 MAD. */
  flat: 20_000_000,
  /** Remplacement d'un article de matériel, par unité : 50 000 MAD. */
  replacement: 5_000_000,
} as const;

export type UnusualPriceKind = keyof typeof UNUSUAL_PRICE_CENTS;

export interface PriceCheck {
  /** Libellé du champ (« Prix TTC », « Prix de remplacement TTC (par unité) »…). */
  label: string;
  cents: number;
  kind: UnusualPriceKind;
  /** Prix déjà enregistré : inchangé, il n'est pas redemandé. */
  previous?: number | null;
}

/** Prix inhabituels et modifiés parmi ceux à enregistrer. */
export function unusualPrices(checks: PriceCheck[]): PriceCheck[] {
  return checks.filter(
    (check) => check.cents > UNUSUAL_PRICE_CENTS[check.kind] && check.cents !== check.previous,
  );
}

/**
 * Confirmation avant d'enregistrer un prix inhabituel : `confirm(checks)` résout true sans
 * question si aucun prix n'est inhabituel, sinon selon le choix (« Corriger » : false).
 * `dialog` est à rendre dans le formulaire.
 */
export function useUnusualPriceConfirm(): {
  confirm: (checks: PriceCheck[]) => Promise<boolean>;
  dialog: ReactNode;
} {
  const t = useTranslations('catalog.unusualPrice');
  const locale = useLocale();
  const [pending, setPending] = useState<{
    prices: PriceCheck[];
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const confirm = useCallback((checks: PriceCheck[]) => {
    const prices = unusualPrices(checks);
    if (prices.length === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPending({ prices, resolve }));
  }, []);

  const close = (confirmed: boolean) => {
    pending?.resolve(confirmed);
    setPending(null);
  };

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent data-testid="unusual-price-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">{t('description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1">
          {pending?.prices.map((price) => (
            <li key={price.label} className="flex flex-wrap justify-between gap-x-4">
              <span>{price.label}</span>
              <span className="font-semibold tabular-nums">{formatMoney(price.cents, locale)}</span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel size="lg">{t('fix')}</AlertDialogCancel>
          <AlertDialogAction size="lg" onClick={() => close(true)}>
            {t('keep')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
