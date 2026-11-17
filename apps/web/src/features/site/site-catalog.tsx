'use client';

import { ArrowRightIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/layout/list-states';
import { LoadError } from '@/components/layout/load-error';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocalized } from '@/features/catalog/use-localized';
import { cn } from '@/lib/utils';

import { CART_KINDS, type CartKind } from './cart-store';
import { CatalogCard } from './catalog-card';
import { catalogEntries } from './catalog-view';
import { comparableEventTypes } from './range-compare';
import { RangeMark } from './range-finish';
import { usePublicCatalog, usePublicCatalogOptions } from './site-api';

/** Code d'une liste (type d'événement, gamme) accepté dans l'adresse. */
const CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

/** Bandeau de titre du site : fond ivoire, ornement zellige discret, police des titres. */
export function SiteTitleBand({
  kicker,
  title,
  lead,
  testId,
}: {
  kicker: string;
  title: string;
  lead: string;
  testId?: string;
}) {
  return (
    <section
      className="relative overflow-hidden border-b bg-gradient-to-b from-[var(--site-sand)] to-background"
      data-testid={testId}
    >
      <div
        aria-hidden
        className="site-zellige pointer-events-none absolute inset-y-0 end-0 w-[46%] opacity-70"
      />
      <div className="relative mx-auto max-w-6xl px-4 pt-8 pb-7 md:pt-10">
        <p className="flex items-center gap-2.5 text-xs font-extrabold tracking-[0.2em] text-[var(--site-accent-text)] uppercase before:h-px before:w-7 before:bg-current rtl:text-sm rtl:tracking-normal">
          {kicker}
        </p>
        <h1 className="site-page-title mt-2 font-display text-[40px] leading-[1.05] font-bold md:text-[64px] rtl:leading-snug">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-base text-muted-foreground md:text-lg">{lead}</p>
        <div aria-hidden className="site-ornament mt-4" />
      </div>
    </section>
  );
}

/** Pastille de filtre (choix unique, état annoncé par aria-pressed). */
function FilterChip({
  pressed,
  onClick,
  children,
  testId,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'inline-flex h-[42px] shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-[#ddd0bc] bg-card text-foreground hover:border-primary',
      )}
    >
      {children}
    </button>
  );
}

/** Ligne de filtres : libellé, puis pastilles défilant à l'horizontale sur téléphone. */
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="grid gap-1.5 md:flex md:items-center md:gap-3">
      <span className="text-[13px] font-extrabold tracking-wider text-muted-foreground uppercase md:w-28 md:shrink-0 rtl:text-sm rtl:tracking-normal">
        {label}
      </span>
      <div className="site-rail -mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 md:mx-0 md:flex-wrap md:px-0">
        {children}
      </div>
    </div>
  );
}

/**
 * Catalogue public : bandeau de titre, filtres en pastilles (type d'événement, gamme avec son
 * symbole) gardés dans l'adresse, onglets Menus / Buffets / Matériel / Services, accès au
 * comparateur de gammes, cartes à la finition de leur gamme. Prix TTC ; jamais de stock ni de
 * donnée interne (l'API publique ne les envoie pas).
 */
export function SiteCatalog() {
  const t = useTranslations('site.catalog');
  const localized = useLocalized();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const eventType = CODE.test(params.get('type') ?? '')
    ? (params.get('type') ?? undefined)
    : undefined;
  const range = CODE.test(params.get('gamme') ?? '')
    ? (params.get('gamme') ?? undefined)
    : undefined;
  const tabParam = params.get('onglet');
  const tab: CartKind = CART_KINDS.find((kind) => kind === tabParam) ?? 'menu';
  const options = usePublicCatalogOptions();
  const catalog = usePublicCatalog({ eventType, range });
  // Comparateur : toutes les gammes, sans filtre de gamme
  const all = usePublicCatalog({});

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const entries = catalog.data ? catalogEntries(catalog.data) : null;
  const ranges = options.data?.ranges ?? [];
  const comparable =
    all.data && options.data
      ? comparableEventTypes(
          all.data,
          ranges,
          options.data.eventTypes.map((item) => item.code),
        )
      : [];
  // Type choisi s'il se compare, sinon le premier type comparable (aucun filtre de type)
  const compareType = eventType
    ? comparable.includes(eventType)
      ? eventType
      : null
    : (comparable[0] ?? null);
  const compareTypeName = options.data?.eventTypes.find((item) => item.code === compareType);

  return (
    <div data-testid="site-catalog">
      <SiteTitleBand kicker={t('kicker')} title={t('heading')} lead={t('subtitle')} />
      <div className="mx-auto flex max-w-6xl flex-col px-4 pb-14">
        <div className="grid gap-3.5 pt-6">
          <FilterRow label={t('filters.eventType')}>
            <FilterChip pressed={!eventType} onClick={() => update('type', null)}>
              {t('filters.allEvents')}
            </FilterChip>
            {options.data?.eventTypes.map((item) => (
              <FilterChip
                key={item.code}
                pressed={eventType === item.code}
                onClick={() => update('type', item.code)}
              >
                {localized(item.name)}
              </FilterChip>
            ))}
          </FilterRow>
          <FilterRow label={t('filters.range')}>
            <FilterChip pressed={!range} onClick={() => update('gamme', null)}>
              {t('filters.allRanges')}
            </FilterChip>
            {ranges.map((item) => (
              <FilterChip
                key={item.code}
                pressed={range === item.code}
                onClick={() => update('gamme', item.code)}
                testId={`range-filter-${item.code}`}
              >
                <RangeMark finish={item.finish} size="sm" />
                {localized(item.name)}
              </FilterChip>
            ))}
          </FilterRow>
        </div>
        <Tabs value={tab} onValueChange={(value) => update('onglet', value)} className="mt-5">
          <div className="site-rail overflow-x-auto border-b">
            <TabsList variant="line" className="h-12 gap-6 p-0">
              {CART_KINDS.map((kind) => (
                <TabsTrigger key={kind} value={kind} className="flex-none px-0 text-base font-bold">
                  {t(`tabs.${kind}`)}
                  {entries && (
                    <span className="text-sm font-semibold text-muted-foreground">
                      {entries[kind].length}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {compareType && tab === 'menu' && (
            <Link
              href={`/catalogue/comparer?type=${compareType}`}
              className="mt-5 flex items-center gap-3.5 rounded-2xl border bg-card px-4 py-3.5 transition-colors hover:border-primary"
              data-testid="compare-link"
            >
              <span className="flex -space-x-1 rtl:space-x-reverse">
                {ranges.map((item) => (
                  <RangeMark key={item.code} finish={item.finish} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">
                  {t('compare', { event: compareTypeName ? localized(compareTypeName.name) : '' })}
                </span>
                <span className="block text-sm text-muted-foreground">{t('compareHint')}</span>
              </span>
              <ArrowRightIcon className="size-5 shrink-0 rtl:rotate-180" aria-hidden />
            </Link>
          )}
          {CART_KINDS.map((kind) => (
            <TabsContent key={kind} value={kind} className="pt-5">
              {catalog.isPending ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {[0, 1, 2].map((key) => (
                    <Skeleton key={key} className="h-96 w-full rounded-[22px]" />
                  ))}
                </div>
              ) : !entries ? (
                <LoadError error={catalog.error} backHref="/" />
              ) : entries[kind].length === 0 ? (
                <EmptyState icon={SearchXIcon} title={t('empty')} description={t('emptyHint')} />
              ) : (
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
                  {entries[kind].map((entry) => (
                    <CatalogCard key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
