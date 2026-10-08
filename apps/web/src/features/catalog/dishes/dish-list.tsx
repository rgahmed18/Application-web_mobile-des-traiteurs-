'use client';

import type { Dish } from '@traiteur/shared';
import { PlusIcon, SearchIcon, UtensilsIcon } from 'lucide-react';
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

import { useCatalogSettings, useCategories, useDishes } from '../catalog-api';
import { CatalogHeader } from '../components/catalog-header';
import { EmptyState, ItemThumb, PaginationBar, StatusBadge } from '../components/catalog-ui';
import { ItemActions } from '../components/item-actions';
import { useDebouncedValue } from '../use-debounced-value';
import { useLocalized } from '../use-localized';

const ALL = 'all';
const PAGE_SIZE = 20;
const BASE = '/admin/catalog/dishes';

export function DishList() {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const router = useRouter();
  const localized = useLocalized();
  const canWrite = usePermission()('catalog.write');
  const settings = useCatalogSettings();
  const categories = useCategories();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState(ALL);
  const [availability, setAvailability] = useState(ALL);
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim());

  const dishes = useDishes({
    search: debouncedSearch || undefined,
    categoryId: categoryId === ALL ? undefined : categoryId,
    availability: availability === ALL ? undefined : (availability as 'available' | 'unavailable'),
    archived: archived || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const categoryName = new Map((categories.data ?? []).map((c) => [c.id, localized(c.name)]));
  const ttcMode = settings.data?.priceEntryMode !== 'HT';
  const priceOf = (dish: Dish) => formatMoney(ttcMode ? dish.priceTtc : dish.priceHt, locale);
  const resetPage =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  const status = (dish: Dish) =>
    dish.archivedAt ? (
      <StatusBadge tone="muted">{t('status.archived')}</StatusBadge>
    ) : dish.isAvailable ? (
      <StatusBadge tone="success">{t('status.available')}</StatusBadge>
    ) : (
      <StatusBadge tone="warning">{t('status.unavailable')}</StatusBadge>
    );

  const actions = (dish: Dish) =>
    canWrite ? (
      <ItemActions
        resource="dishes"
        id={dish.id}
        name={localized(dish.name)}
        archived={dish.archivedAt !== null}
        inUse={dish.inUse}
        onEdit={() => router.push(`${BASE}/${dish.id}`)}
        onDuplicate={() => router.push(`${BASE}/new?from=${dish.id}`)}
      />
    ) : null;

  const items = dishes.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <CatalogHeader
        action={
          canWrite && (
            <Button asChild size="lg">
              <Link href={`${BASE}/new`}>
                <PlusIcon aria-hidden />
                {t('dishes.new')}
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
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
            {(categories.data ?? []).map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {localized(category.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={availability} onValueChange={resetPage(setAvailability)}>
          <SelectTrigger className="w-full" aria-label={t('fields.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
            <SelectItem value="available">{t('status.available')}</SelectItem>
            <SelectItem value="unavailable">{t('status.unavailable')}</SelectItem>
          </SelectContent>
        </Select>
        <Field orientation="horizontal" className="h-11 md:justify-end">
          <Switch id="show-archived" checked={archived} onCheckedChange={resetPage(setArchived)} />
          <FieldLabel htmlFor="show-archived" className="text-base font-normal">
            {t('filters.showArchived')}
          </FieldLabel>
        </Field>
      </div>

      {dishes.data && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('filters.results', { count: dishes.data.total })}
        </p>
      )}

      {dishes.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={UtensilsIcon}
          title={t('dishes.empty')}
          description={t('dishes.emptyHint')}
          action={
            canWrite &&
            !archived && (
              <Button asChild size="lg">
                <Link href={`${BASE}/new`}>{t('dishes.new')}</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="dish-list">
          {items.map((dish) => {
            const name = localized(dish.name);
            return (
              <li key={dish.id} className="flex items-center gap-4 p-3 sm:p-4">
                <ItemThumb imageKey={dish.imageKey} alt={t('photo.alt', { name })} />
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    {canWrite ? (
                      <Link
                        href={`${BASE}/${dish.id}`}
                        className="block truncate text-base font-medium hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="block truncate text-base font-medium">{name}</span>
                    )}
                    <span className="block truncate text-sm text-muted-foreground">
                      {(dish.categoryId && categoryName.get(dish.categoryId)) ??
                        t('fields.noCategory')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="font-medium tabular-nums" dir="ltr">
                      {priceOf(dish)}
                    </span>
                    <span className="text-sm text-muted-foreground">{t(`units.${dish.unit}`)}</span>
                    {status(dish)}
                  </div>
                </div>
                {actions(dish)}
              </li>
            );
          })}
        </ul>
      )}

      {dishes.data && (
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={dishes.data.total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
