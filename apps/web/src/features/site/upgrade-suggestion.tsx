'use client';

import { XIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useLocalized } from '@/features/catalog/use-localized';
import { formatMoney } from '@/lib/format/money';

import { cartStore, useCart } from './cart-store';
import type { CatalogEntry } from './catalog-view';
import { addedLines, upgradeFor } from './range-compare';
import { isLeadLine, RangeMark, useIncludedLines } from './range-finish';
import { usePublicCatalog, usePublicCatalogOptions, usePublicSite } from './site-api';

/** Suggestions refusées pendant la visite (« Non merci ») : plus montrées pour ce menu. */
const DISMISSED_KEY = 'gt-montee-refusee';

function readDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Lignes ajoutées montrées dans l'encart (les premières seulement : il reste discret). */
const ADDED_SHOWN = 3;

/**
 * Suggestion discrète de montée en gamme, sous un menu de « Ma demande » : menu équivalent de la
 * gamme juste au-dessus, même type d'événement, avec le supplément par personne et ce que la
 * gamme ajoute. « Passer en … » remplace le menu ; « Non merci » la masque. Désactivable par le
 * traiteur (Paramètres → Site client).
 */
export function UpgradeSuggestion({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('site.upgrade');
  const localized = useLocalized();
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  const site = usePublicSite();
  const options = usePublicCatalogOptions();
  const catalog = usePublicCatalog();
  const cart = useCart();
  const included = useIncludedLines();
  const [dismissed, setDismissed] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readDismissed(),
  );
  const menu = catalog.data?.menus.find((item) => item.id === entry.id);
  if (entry.kind !== 'menu' || !site.data?.upsell || !options.data || !catalog.data || !menu) {
    return null;
  }
  if (dismissed.includes(menu.id)) return null;
  const upgrade = upgradeFor(catalog.data, options.data.ranges, menu, (id) =>
    cart.some((item) => item.kind === 'menu' && item.id === id),
  );
  if (!upgrade) return null;
  const rangeName = localized(upgrade.range.name);
  const fromRange = options.data.ranges.find((range) => range.code === menu.range?.code);
  const added = addedLines(fromRange ? included(fromRange) : [], included(upgrade.range)).filter(
    (line) => !isLeadLine(line),
  );
  const extraDishes = upgrade.to.dishes.length - menu.dishes.length;

  const dismiss = () => {
    const next = [...dismissed, menu.id];
    setDismissed(next);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Stockage indisponible (navigation privée) : masquée jusqu'au rechargement
    }
  };

  return (
    <aside
      aria-label={t('label')}
      className="relative basis-full rounded-2xl border-[1.5px] border-dashed border-[#d8b58d] bg-[#fffaf3] p-4 pe-12"
      data-testid="upgrade-suggestion"
    >
      <button
        type="button"
        onClick={dismiss}
        className="absolute end-2 top-2 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5"
        aria-label={t('dismiss')}
        data-testid="upgrade-dismiss"
      >
        <XIcon className="size-4" aria-hidden />
      </button>
      <p className="flex gap-2 text-[15px]">
        <RangeMark finish={upgrade.range.finish} size="sm" />
        <span dir="auto">
          {t.rich('text', {
            extra: formatMoney(upgrade.extraPerPerson, locale),
            range: rangeName,
            menu: localized(upgrade.to.name),
            strong: (chunks) => <strong className="text-[#6b4421]">{chunks}</strong>,
          })}
        </span>
      </p>
      {(added.length > 0 || extraDishes > 0) && (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 ps-8 text-sm text-muted-foreground">
          {added.slice(0, ADDED_SHOWN).map((line, index) => (
            <li key={index} dir="auto">
              <span className="font-extrabold text-[#9a6634]" aria-hidden>
                +{' '}
              </span>
              {line}
            </li>
          ))}
          {extraDishes > 0 && (
            <li>
              <span className="font-extrabold text-[#9a6634]" aria-hidden>
                +{' '}
              </span>
              {t('moreDishes', { count: extraDishes })}
            </li>
          )}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2 ps-8">
        <Button
          size="sm"
          className="h-10 rounded-full bg-[#6b4421] px-4 text-white hover:bg-[#5a391b]"
          onClick={() => cartStore.replace('menu', menu.id, upgrade.to.id)}
          data-testid="upgrade-accept"
        >
          {t('accept', { range: rangeName })}
        </Button>
        <Button asChild size="sm" variant="ghost" className="h-10 rounded-full px-4">
          <Link href={`/catalogue/menu/${upgrade.to.id}`}>{t('see')}</Link>
        </Button>
      </div>
    </aside>
  );
}
