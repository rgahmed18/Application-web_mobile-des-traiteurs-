'use client';

import {
  addDays,
  EVENT_TYPES,
  type EventType,
  ORDER_STATUSES,
  type OrderListQuery,
  type OrderStatus,
  startOfMonth,
  startOfNextMonth,
  todayInTimeZone,
} from '@traiteur/shared';
import { ClipboardListIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState, PaginationBar } from '@/components/layout/list-states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { clientName } from '@/features/clients/clients-api';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

import { OrderStatusBadge } from './order-ui';
import { useOrders } from './orders-api';

const PAGE_SIZE = 20;
const ALL = 'all';
const PERIODS = ['upcoming', 'thisMonth', 'past', 'all', 'custom'] as const;
type Period = (typeof PERIODS)[number];

/** Statuts proposés dans le filtre ; « actives » = tout sauf annulées et clôturées. */
type StatusFilter = OrderStatus | typeof ALL | 'TO_CLOSE';

function periodRange(
  period: Period,
  today: string,
  from: string,
  to: string,
): Partial<OrderListQuery> {
  switch (period) {
    case 'upcoming':
      return { from: today, direction: 'asc' };
    case 'thisMonth':
      return {
        from: startOfMonth(today),
        to: addDays(startOfNextMonth(today), -1),
        direction: 'asc',
      };
    case 'past':
      return { to: addDays(today, -1), direction: 'desc' };
    case 'custom':
      return { from: from || undefined, to: to || undefined, direction: 'asc' };
    default:
      return { direction: 'desc' };
  }
}

export function OrderList() {
  const t = useTranslations('orders');
  const tStatus = useTranslations('orderStatus');
  const tEvent = useTranslations('eventType');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canCreate = usePermission()('orders.create');
  const timeZone = useTimeZone();
  const today = todayInTimeZone(timeZone);

  // Filtres initiaux depuis l'URL (liens du tableau de bord : ?status=PENDING, ?toClose=true…)
  const initialStatus =
    params.get('toClose') === 'true' ? 'TO_CLOSE' : (params.get('status') ?? ALL);
  const [status, setStatus] = useState<StatusFilter>(
    initialStatus === 'TO_CLOSE' || (ORDER_STATUSES as readonly string[]).includes(initialStatus)
      ? (initialStatus as StatusFilter)
      : ALL,
  );
  const [period, setPeriod] = useState<Period>(
    (PERIODS as readonly string[]).includes(params.get('period') ?? '')
      ? (params.get('period') as Period)
      : initialStatus === ALL
        ? 'upcoming'
        : 'all',
  );
  const [eventType, setEventType] = useState<EventType | typeof ALL>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim());

  const statusQuery: Partial<OrderListQuery> =
    status === 'TO_CLOSE' ? { toClose: true } : status === ALL ? {} : { status: [status] };
  const orders = useOrders({
    ...periodRange(period, today, from, to),
    ...statusQuery,
    eventType: eventType === ALL ? undefined : eventType,
    search: debouncedSearch || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const items = orders.data?.items ?? [];
  const filtered =
    status !== ALL || eventType !== ALL || period !== 'upcoming' || debouncedSearch !== '';

  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
      if (params.size > 0) router.replace(pathname);
    };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canCreate && (
            <Button asChild size="lg">
              <Link href="/admin/orders/new">
                <PlusIcon aria-hidden />
                {t('new')}
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            aria-label={t('filters.search')}
            placeholder={t('filters.search')}
            onChange={(event) => reset(setSearch)(event.target.value)}
          />
        </InputGroup>
        <Select value={status} onValueChange={(value) => reset(setStatus)(value as StatusFilter)}>
          <SelectTrigger className="w-full" aria-label={t('filters.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
            <SelectItem value="TO_CLOSE">{t('filters.toClose')}</SelectItem>
            {ORDER_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {tStatus(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(value) => reset(setPeriod)(value as Period)}>
          <SelectTrigger className="w-full" aria-label={t('filters.period')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`filters.periods.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={eventType}
          onValueChange={(value) => reset(setEventType)(value as EventType)}
        >
          <SelectTrigger className="w-full" aria-label={t('filters.eventType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allTypes')}</SelectItem>
            {EVENT_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {tEvent(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {period === 'custom' && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('filters.from')}
            <Input
              type="date"
              dir="ltr"
              value={from}
              onChange={(event) => reset(setFrom)(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('filters.to')}
            <Input
              type="date"
              dir="ltr"
              value={to}
              onChange={(event) => reset(setTo)(event.target.value)}
            />
          </label>
        </div>
      )}

      {filtered && (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => {
            setStatus(ALL);
            setEventType(ALL);
            setPeriod('upcoming');
            setSearch('');
            setPage(1);
            router.replace(pathname);
          }}
        >
          <XIcon aria-hidden />
          {t('filters.reset')}
        </Button>
      )}

      {orders.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardListIcon}
          title={t('empty')}
          description={filtered ? t('noMatch') : t('emptyHint')}
          action={
            canCreate &&
            !filtered && (
              <Button asChild size="lg">
                <Link href="/admin/orders/new">{t('new')}</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="order-list">
          {items.map((order) => (
            <li key={order.id}>
              <Link
                href={`/admin/orders/${order.id}`}
                className="grid gap-2 p-3 hover:bg-muted/50 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_8rem_auto] sm:items-center sm:gap-4 sm:p-4"
              >
                <span className="font-medium" dir="ltr">
                  {order.reference}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{clientName(order.client)}</span>
                  <span className="block text-sm text-muted-foreground">
                    {tEvent(order.eventType)} · {t('guests', { count: order.guestCount })}
                  </span>
                </span>
                <span className="text-sm">
                  <span dir="ltr">
                    {formatLocalDate(order.eventDate)} {order.startTime}
                  </span>
                  <span className="block text-muted-foreground">{order.city}</span>
                </span>
                <span className="font-medium tabular-nums sm:text-end" dir="ltr">
                  {formatMoney(order.totalTtc, locale)}
                </span>
                <OrderStatusBadge
                  status={order.status}
                  className="justify-self-start sm:justify-self-end"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {orders.data && (
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={orders.data.total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
