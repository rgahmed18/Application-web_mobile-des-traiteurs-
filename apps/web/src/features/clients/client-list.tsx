'use client';

import { CLIENT_SORTS, type ClientListQuery } from '@traiteur/shared';
import {
  ArrowDownWideNarrowIcon,
  ArrowUpNarrowWideIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState, PaginationBar } from '@/components/layout/list-states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/session-provider';
import { useDebouncedValue } from '@/features/catalog/use-debounced-value';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

import { ClientFormDialog } from './client-form-dialog';
import { clientName, useClients } from './clients-api';

const PAGE_SIZE = 20;

type Sort = ClientListQuery['sort'];

export function ClientList() {
  const t = useTranslations('clients');
  const locale = useLocale();
  const router = useRouter();
  const canWrite = usePermission()('clients.write');
  const timeZone = useTimeZone();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim());

  const clients = useClients({
    search: debouncedSearch || undefined,
    sort,
    direction,
    page,
    pageSize: PAGE_SIZE,
  });
  const items = clients.data?.items ?? [];

  const changeSort = (value: Sort) => {
    setSort(value);
    // Nom et prochain événement : ordre croissant ; montants et dates passées : du plus récent
    setDirection(value === 'name' || value === 'nextOrder' ? 'asc' : 'desc');
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canWrite && (
            <Button size="lg" onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden />
              {t('new')}
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
            aria-label={t('search')}
            placeholder={t('search')}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </InputGroup>
        <Select value={sort} onValueChange={(value) => changeSort(value as Sort)}>
          <SelectTrigger className="w-full" aria-label={t('sortLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLIENT_SORTS.map((value) => (
              <SelectItem key={value} value={value}>
                {t('sortLabel')} : {t(`sort.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label={direction === 'asc' ? t('ascending') : t('descending')}
          title={direction === 'asc' ? t('ascending') : t('descending')}
          onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
        >
          {direction === 'asc' ? (
            <ArrowUpNarrowWideIcon aria-hidden />
          ) : (
            <ArrowDownWideNarrowIcon aria-hidden />
          )}
        </Button>
      </div>

      {clients.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={t('empty')}
          description={t('emptyHint')}
          action={
            canWrite && (
              <Button size="lg" onClick={() => setCreating(true)}>
                {t('new')}
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="client-list">
          {items.map((client) => (
            <li key={client.id}>
              <Link
                href={`/admin/clients/${client.id}`}
                className="flex flex-col gap-2 p-3 hover:bg-muted/50 focus-visible:bg-muted/50 sm:flex-row sm:items-center sm:gap-4 sm:p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">{clientName(client)}</p>
                  <p className="text-sm text-muted-foreground" dir="ltr">
                    {client.phone}
                  </p>
                </div>
                {client.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {client.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:w-[34rem] sm:grid-cols-4 sm:text-end">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('columns.orders')}</dt>
                    <dd>{t('orderCount', { count: client.orderCount })}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('columns.lastOrder')}</dt>
                    <dd dir="ltr" data-testid="client-last-order">
                      {client.lastOrderAt ? formatDate(client.lastOrderAt, timeZone) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('columns.nextOrder')}</dt>
                    <dd dir="ltr" data-testid="client-next-order">
                      {client.nextOrderAt ? formatDate(client.nextOrderAt, timeZone) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('columns.totalSpent')}</dt>
                    <dd className="font-medium tabular-nums" dir="ltr">
                      {formatMoney(client.totalSpent, locale)}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {clients.data && (
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={clients.data.total}
          onPageChange={setPage}
        />
      )}

      {creating && (
        <ClientFormDialog
          onClose={() => setCreating(false)}
          onSaved={(client) => router.push(`/admin/clients/${client.id}`)}
          onExisting={(id) => router.push(`/admin/clients/${id}`)}
        />
      )}
    </div>
  );
}
