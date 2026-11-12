'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { SearchXIcon } from 'lucide-react';

import { EmptyState } from '@/components/layout/list-states';
import { LoadError } from '@/components/layout/load-error';
import { Select, SelectContent, SelectItem } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FilterTrigger } from '@/features/catalog/components/catalog-ui';
import { useLocalized } from '@/features/catalog/use-localized';

import { CART_KINDS, type CartKind } from './cart-store';
import { CatalogCard } from './catalog-card';
import { catalogEntries } from './catalog-view';
import { usePublicCatalog, usePublicCatalogOptions } from './site-api';

const ALL = 'all';
/** Code d'une liste (type d'événement, gamme) accepté dans l'adresse. */
const CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

/**
 * Catalogue public : menus, buffets, matériel et services publiés, prix TTC, filtres par type
 * d'événement et par gamme (gardés dans l'adresse, partageable). Jamais de stock ni de donnée
 * interne : l'API publique ne les envoie pas.
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

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const entries = catalog.data ? catalogEntries(catalog.data) : null;

  return (
    <div className="flex flex-col gap-5" data-testid="site-catalog">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Select
          value={eventType ?? ALL}
          onValueChange={(value) => update('type', value === ALL ? null : value)}
        >
          <FilterTrigger label={t('filters.eventType')} />
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allEvents')}</SelectItem>
            {options.data?.eventTypes.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {localized(item.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={range ?? ALL}
          onValueChange={(value) => update('gamme', value === ALL ? null : value)}
        >
          <FilterTrigger label={t('filters.range')} />
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allRanges')}</SelectItem>
            {options.data?.ranges.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {localized(item.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Tabs value={tab} onValueChange={(value) => update('onglet', value)}>
        <div className="overflow-x-auto">
          <TabsList>
            {CART_KINDS.map((kind) => (
              <TabsTrigger key={kind} value={kind}>
                {t(`tabs.${kind}`)}
                {entries && (
                  <span className="ms-1 text-muted-foreground">({entries[kind].length})</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {CART_KINDS.map((kind) => (
          <TabsContent key={kind} value={kind} className="pt-4">
            {catalog.isPending ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((key) => (
                  <Skeleton key={key} className="h-72 w-full" />
                ))}
              </div>
            ) : !entries ? (
              <LoadError error={catalog.error} backHref="/" />
            ) : entries[kind].length === 0 ? (
              <EmptyState icon={SearchXIcon} title={t('empty')} description={t('emptyHint')} />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {entries[kind].map((entry) => (
                  <CatalogCard key={entry.id} entry={entry} />
                ))}
              </ul>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
