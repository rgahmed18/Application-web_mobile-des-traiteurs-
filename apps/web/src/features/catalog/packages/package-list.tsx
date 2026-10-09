'use client';

import type { Package } from '@traiteur/shared';
import { PackageIcon, PlusIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePermission } from '@/features/auth/session-provider';
import { formatMoney } from '@/lib/format/money';
import { EmptyState, PaginationBar } from '@/components/layout/list-states';

import { useCatalogSettings, usePackages } from '../catalog-api';
import { CatalogHeader } from '../components/catalog-header';
import { ItemThumb, StatusBadge } from '../components/catalog-ui';
import { ItemActions } from '../components/item-actions';
import { useDebouncedValue } from '../use-debounced-value';
import { useLocalized } from '../use-localized';

const ALL = 'all';
const PAGE_SIZE = 20;
const BASE = '/admin/catalog/packages';

export function PackageList() {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const router = useRouter();
  const localized = useLocalized();
  const canWrite = usePermission()('catalog.write');
  const settings = useCatalogSettings();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim());

  const packages = usePackages({
    search: debouncedSearch || undefined,
    status: status === ALL ? undefined : (status as 'active' | 'inactive'),
    archived: archived || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const ttcMode = settings.data?.priceEntryMode !== 'HT';
  const resetPage =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  const guests = (pkg: Package) =>
    pkg.maxGuests === null
      ? t('packages.guestsFrom', { min: pkg.minGuests })
      : t('packages.guestsRange', { min: pkg.minGuests, max: pkg.maxGuests });

  const badge = (pkg: Package) =>
    pkg.archivedAt ? (
      <StatusBadge tone="muted">{t('status.archived')}</StatusBadge>
    ) : pkg.isActive ? (
      <StatusBadge tone="success">{t('status.active')}</StatusBadge>
    ) : (
      <StatusBadge tone="warning">{t('status.inactive')}</StatusBadge>
    );

  const items = packages.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <CatalogHeader
        action={
          canWrite && (
            <Button asChild size="lg">
              <Link href={`${BASE}/new`}>
                <PlusIcon aria-hidden />
                {t('packages.new')}
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            aria-label={t('filters.search')}
            placeholder={t('filters.search')}
            onChange={(event) => resetPage(setSearch)(event.target.value)}
          />
        </InputGroup>
        <Select value={status} onValueChange={resetPage(setStatus)}>
          <SelectTrigger className="w-full" aria-label={t('fields.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
            <SelectItem value="active">{t('status.active')}</SelectItem>
            <SelectItem value="inactive">{t('status.inactive')}</SelectItem>
          </SelectContent>
        </Select>
        <Field orientation="horizontal" className="h-11 md:justify-end">
          <Switch id="show-archived" checked={archived} onCheckedChange={resetPage(setArchived)} />
          <FieldLabel htmlFor="show-archived" className="text-base font-normal">
            {t('filters.showArchived')}
          </FieldLabel>
        </Field>
      </div>

      {packages.data && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('filters.results', { count: packages.data.total })}
        </p>
      )}

      {packages.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title={t('packages.empty')}
          description={t('packages.emptyHint')}
          action={
            canWrite &&
            !archived && (
              <Button asChild size="lg">
                <Link href={`${BASE}/new`}>{t('packages.new')}</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="package-list">
          {items.map((pkg) => {
            const name = localized(pkg.name);
            return (
              <li key={pkg.id} className="flex items-center gap-4 p-3 sm:p-4">
                <ItemThumb imageKey={pkg.imageKey} alt={t('photo.alt', { name })} />
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    {canWrite ? (
                      <Link
                        href={`${BASE}/${pkg.id}`}
                        className="block truncate text-base font-medium hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="block truncate text-base font-medium">{name}</span>
                    )}
                    <span className="block truncate text-sm text-muted-foreground">
                      {t('packages.dishCount', { count: pkg.dishes.length })} · {guests(pkg)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="font-medium tabular-nums" dir="ltr">
                      {formatMoney(ttcMode ? pkg.pricePerPersonTtc : pkg.pricePerPersonHt, locale)}
                    </span>
                    <span className="text-sm text-muted-foreground">{t('units.PER_PERSON')}</span>
                    {badge(pkg)}
                  </div>
                </div>
                {canWrite && (
                  <ItemActions
                    resource="packages"
                    id={pkg.id}
                    name={name}
                    archived={pkg.archivedAt !== null}
                    inUse={pkg.inUse}
                    onEdit={() => router.push(`${BASE}/${pkg.id}`)}
                    onDuplicate={() => router.push(`${BASE}/new?from=${pkg.id}`)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {packages.data && (
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={packages.data.total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
