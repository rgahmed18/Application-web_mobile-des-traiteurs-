'use client';

import type { Equipment } from '@traiteur/shared';
import { ArmchairIcon, PlusIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState, PaginationBar } from '@/components/layout/list-states';
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

import { useCatalogList, useCatalogSettings, useEquipmentList } from '../catalog-api';
import { CatalogHeader } from '../components/catalog-header';
import { ItemThumb, StatusBadge } from '../components/catalog-ui';
import { ItemActions } from '../components/item-actions';
import { useDebouncedValue } from '../use-debounced-value';
import { useLocalized } from '../use-localized';

const ALL = 'all';
const PAGE_SIZE = 20;
const BASE = '/admin/catalog/equipment';

/** Matériel de fête : recherche, catégorie, gamme, archives ; location et stock. */
export function EquipmentList() {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const router = useRouter();
  const localized = useLocalized();
  const canWrite = usePermission()('catalog.write');
  const settings = useCatalogSettings();
  const categories = useCatalogList('equipment-categories');
  const ranges = useCatalogList('ranges');

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState(ALL);
  const [rangeId, setRangeId] = useState(ALL);
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim());

  const equipment = useEquipmentList({
    search: debouncedSearch || undefined,
    categoryId: categoryId === ALL ? undefined : categoryId,
    rangeId: rangeId === ALL ? undefined : rangeId,
    archived: archived || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const ttc = settings.data?.priceEntryMode !== 'HT';
  const resetPage =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };
  const status = (item: Equipment) =>
    item.archivedAt ? (
      <StatusBadge tone="muted">{t('status.archived')}</StatusBadge>
    ) : item.isActive ? (
      <StatusBadge tone="success">{t('status.active')}</StatusBadge>
    ) : (
      <StatusBadge tone="warning">{t('status.inactive')}</StatusBadge>
    );
  const items = equipment.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <CatalogHeader
        action={
          canWrite && (
            <Button asChild size="lg">
              <Link href={`${BASE}/new`}>
                <PlusIcon aria-hidden />
                {t('equipment.new')}
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto] lg:items-end">
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
        <Select value={categoryId} onValueChange={resetPage(setCategoryId)}>
          <SelectTrigger className="w-full" aria-label={t('fields.category')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allCategories')}</SelectItem>
            {(categories.data ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {localized(item.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={rangeId} onValueChange={resetPage(setRangeId)}>
          <SelectTrigger className="w-full" aria-label={t('packages.range')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('packages.allRanges')}</SelectItem>
            {(ranges.data ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {localized(item.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Field orientation="horizontal" className="h-11 lg:justify-end">
          <Switch id="show-archived" checked={archived} onCheckedChange={resetPage(setArchived)} />
          <FieldLabel htmlFor="show-archived" className="text-base font-normal">
            {t('filters.showArchived')}
          </FieldLabel>
        </Field>
      </div>

      {equipment.data && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('filters.results', { count: equipment.data.total })}
        </p>
      )}

      {equipment.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ArmchairIcon}
          title={t('equipment.empty')}
          description={t('equipment.emptyHint')}
          action={
            canWrite &&
            !archived && (
              <Button asChild size="lg">
                <Link href={`${BASE}/new`}>{t('equipment.new')}</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="equipment-list">
          {items.map((item) => {
            const name = localized(item.name);
            return (
              <li key={item.id} className="flex items-center gap-4 p-3 sm:p-4">
                <ItemThumb imageKey={item.imageKey} alt={t('photo.alt', { name })} />
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    {canWrite ? (
                      <Link
                        href={`${BASE}/${item.id}`}
                        className="block truncate text-base font-medium hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="block truncate text-base font-medium">{name}</span>
                    )}
                    <span className="block truncate text-sm text-muted-foreground">
                      {item.category ? localized(item.category.name) : t('fields.noCategory')}
                      {item.range && ` · ${localized(item.range.name)}`}
                      {' · '}
                      {t('equipment.inStock', { count: item.stockQuantity })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="font-medium tabular-nums" dir="ltr">
                      {formatMoney(ttc ? item.priceTtc : item.priceHt, locale)}
                    </span>
                    <span className="text-sm text-muted-foreground">{t('equipment.perUnit')}</span>
                    {status(item)}
                  </div>
                </div>
                {canWrite && (
                  <ItemActions
                    resource="equipment"
                    id={item.id}
                    name={name}
                    archived={item.archivedAt !== null}
                    inUse={item.inUse}
                    onEdit={() => router.push(`${BASE}/${item.id}`)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {equipment.data && (
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={equipment.data.total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
