'use client';

import {
  type CalendarDay,
  type CalendarOrder,
  startOfMonth,
  todayInTimeZone,
} from '@traiteur/shared';
import { ChevronLeftIcon, ChevronRightIcon, SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermission } from '@/features/auth/session-provider';
import { STATUS_STYLES } from '@/features/orders/order-ui';
import { useCalendar, useSetCapacity } from '@/features/orders/orders-api';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatLocalDate, formatLongDate, monthName, weekdayName } from '@/lib/format/date';
import { cn } from '@/lib/utils';

import {
  CALENDAR_VIEWS,
  type CalendarView as View,
  calendarRange,
  shiftAnchor,
} from './calendar-range';
import { DaySheet } from './day-sheet';
import { LoadIndicator } from './load-indicator';

const MAX_CHIPS = 3;

/** Commande dans une case du calendrier : heure et client, couleur du statut. */
function OrderChip({ order, compact }: { order: CalendarOrder; compact: boolean }) {
  return (
    <Link
      href={`/admin/orders/${order.id}`}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'flex min-w-0 flex-wrap items-baseline gap-x-1 rounded-md border-s-4 px-1.5 py-0.5 text-start text-xs hover:opacity-80',
        STATUS_STYLES[order.status].chip,
        !compact && 'py-1.5 text-sm',
      )}
      data-testid="calendar-order"
    >
      <span className="shrink-0 font-semibold tabular-nums" dir="ltr">
        {order.startTime}
      </span>
      {/* dir="auto" : un nom latin reste lisible (tronqué à sa fin) dans l'interface arabe */}
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {order.clientName}
      </span>
      {!compact && (
        <span className="w-full text-xs opacity-80" dir="ltr">
          {order.reference}
        </span>
      )}
    </Link>
  );
}

function CapacityDialog({ capacity, onClose }: { capacity: number | null; onClose: () => void }) {
  const t = useTranslations('calendar.capacity');
  const tc = useTranslations('common');
  const describeError = useErrorMessage();
  const save = useSetCapacity();
  const [unlimited, setUnlimited] = useState(capacity === null);
  const [value, setValue] = useState(String(capacity ?? 3));
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  const invalid = !unlimited && (!Number.isInteger(parsed) || parsed < 1 || parsed > 100);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (invalid) return;
            save.mutate(
              { maxEventsPerDay: unlimited ? null : parsed },
              {
                onSuccess: () => {
                  toast.success(t('saved'));
                  onClose();
                },
                onError: (error) => toast.error(describeError(error)),
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription className="text-base">{t('description')}</DialogDescription>
          </DialogHeader>
          <Field orientation="horizontal">
            <Switch id="capacity-unlimited" checked={unlimited} onCheckedChange={setUnlimited} />
            <FieldLabel htmlFor="capacity-unlimited" className="text-base font-normal">
              {t('unlimited')}
            </FieldLabel>
          </Field>
          {!unlimited && (
            <label className="flex flex-col gap-2">
              <span className="font-medium">{t('label')}</span>
              <Input
                inputMode="numeric"
                dir="ltr"
                className="w-32"
                value={value}
                aria-invalid={invalid}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={invalid || save.isPending}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CalendarView() {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const params = useSearchParams();
  const can = usePermission();
  const timeZone = useTimeZone();
  const today = todayInTimeZone(timeZone);

  const initialView = params.get('view');
  const [view, setView] = useState<View>(
    (CALENDAR_VIEWS as readonly string[]).includes(initialView ?? '')
      ? (initialView as View)
      : 'month',
  );
  const [anchor, setAnchor] = useState(today);
  const [showCancelled, setShowCancelled] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingCapacity, setEditingCapacity] = useState(false);

  const range = calendarRange(view, anchor);
  const calendar = useCalendar({
    from: range.from,
    to: range.to,
    includeCancelled: showCancelled || undefined,
  });
  const data = calendar.data;
  const dayByDate = new Map((data?.days ?? []).map((day) => [day.date, day]));
  const ordersOf = (date: string) => (data?.orders ?? []).filter((order) => order.date === date);
  const emptyDay = (date: string): CalendarDay => ({
    date,
    blocked: false,
    blockedReason: null,
    firmCount: 0,
    pendingCount: 0,
  });
  const capacity = data?.capacity ?? null;
  const currentMonth = startOfMonth(anchor).slice(0, 7);

  const title =
    view === 'week'
      ? `${formatLocalDate(range.from)} – ${formatLocalDate(range.to)}`
      : `${monthName(anchor, locale)} ${anchor.slice(0, 4)}`;
  const weekdays = calendarRange('week', today).days;

  const dayCell = (date: string, variant: 'month' | 'week') => {
    const day = dayByDate.get(date) ?? emptyDay(date);
    const orders = ordersOf(date);
    const outside = variant === 'month' && date.slice(0, 7) !== currentMonth;
    const visible = variant === 'month' ? orders.slice(0, MAX_CHIPS) : orders;
    return (
      <div
        key={date}
        role="button"
        tabIndex={0}
        aria-label={formatLongDate(date, locale)}
        data-testid={`day-${date}`}
        onClick={() => setSelected(date)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelected(date);
          }
        }}
        className={cn(
          'flex min-h-28 cursor-pointer flex-col gap-1 bg-card p-1.5 text-start outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          variant === 'week' && 'min-h-48 p-2',
          outside && 'bg-muted/30 text-muted-foreground',
          day.blocked &&
            'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--color-muted)_6px,var(--color-muted)_12px)]',
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <span
            className={cn(
              'flex size-7 items-center justify-center rounded-full text-sm font-medium tabular-nums',
              date === today && 'bg-primary text-primary-foreground',
            )}
          >
            {variant === 'week'
              ? `${weekdayName(date, locale)} ${Number(date.slice(8))}`
              : Number(date.slice(8))}
          </span>
          <LoadIndicator day={day} capacity={capacity} compact />
        </div>
        {day.blocked && (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {t('blocked')}
          </span>
        )}
        <div className="flex flex-col gap-1">
          {visible.map((order) => (
            <OrderChip key={order.id} order={order} compact={variant === 'month'} />
          ))}
          {orders.length > visible.length && (
            <span className="text-xs text-muted-foreground" dir="ltr">
              {t('more', { count: orders.length - visible.length })}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          can('calendar.manage') && (
            <Button variant="outline" onClick={() => setEditingCapacity(true)}>
              <SettingsIcon aria-hidden />
              {t('capacity.button', { capacity: capacity === null ? 'none' : String(capacity) })}
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t('previous')}
            onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
          >
            <ChevronLeftIcon className="rtl:rotate-180" aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => setAnchor(today)}>
            {t('today')}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('next')}
            onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
          >
            <ChevronRightIcon className="rtl:rotate-180" aria-hidden />
          </Button>
          <h2
            className="ms-2 text-xl font-semibold first-letter:uppercase"
            aria-live="polite"
            data-testid="calendar-title"
          >
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Field orientation="horizontal" className="w-auto">
            <Switch
              id="show-cancelled"
              checked={showCancelled}
              onCheckedChange={setShowCancelled}
            />
            <FieldLabel htmlFor="show-cancelled" className="font-normal">
              {t('showCancelled')}
            </FieldLabel>
          </Field>
          <Tabs value={view} onValueChange={(value) => setView(value as View)}>
            <TabsList>
              {CALENDAR_VIEWS.map((value) => (
                <TabsTrigger key={value} value={value} className="px-4">
                  {t(`views.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {!data ? (
        <Skeleton className="h-[32rem] w-full" />
      ) : view === 'list' ? (
        <ListView
          days={range.days}
          ordersOf={ordersOf}
          dayByDate={dayByDate}
          capacity={capacity}
          onSelect={setSelected}
        />
      ) : (
        <div className="overflow-x-auto">
          <div
            className={cn(
              'grid gap-px overflow-hidden rounded-xl border bg-border',
              view === 'month' ? 'min-w-[44rem]' : 'min-w-[56rem]',
            )}
            style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
            data-testid="calendar-grid"
          >
            {view === 'month' &&
              weekdays.map((date) => (
                <div
                  key={date}
                  className="bg-muted/60 px-2 py-1.5 text-center text-sm font-medium first-letter:uppercase"
                >
                  {weekdayName(date, locale)}
                </div>
              ))}
            {range.days.map((date) => dayCell(date, view === 'week' ? 'week' : 'month'))}
          </div>
        </div>
      )}

      <DaySheet
        day={selected ? (dayByDate.get(selected) ?? emptyDay(selected)) : null}
        orders={data?.orders ?? []}
        capacity={capacity}
        onClose={() => setSelected(null)}
      />
      {editingCapacity && (
        <CapacityDialog capacity={capacity} onClose={() => setEditingCapacity(false)} />
      )}
    </div>
  );
}

function ListView({
  days,
  ordersOf,
  dayByDate,
  capacity,
  onSelect,
}: {
  days: string[];
  ordersOf: (date: string) => CalendarOrder[];
  dayByDate: Map<string, CalendarDay>;
  capacity: number | null;
  onSelect: (date: string) => void;
}) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const withContent = days.filter(
    (date) => ordersOf(date).length > 0 || dayByDate.get(date)?.blocked,
  );
  if (withContent.length === 0)
    return <p className="py-12 text-center text-muted-foreground">{t('emptyList')}</p>;
  return (
    <ol className="flex flex-col gap-4" data-testid="calendar-list">
      {withContent.map((date) => {
        const day = dayByDate.get(date);
        return (
          <li key={date} className="flex flex-col gap-2">
            <button
              type="button"
              className="flex items-center gap-3 self-start text-start hover:underline"
              onClick={() => onSelect(date)}
            >
              <span className="text-lg font-semibold first-letter:uppercase">
                {formatLongDate(date, locale)}
              </span>
              {day && <LoadIndicator day={day} capacity={capacity} />}
              {day?.blocked && (
                <span className="text-sm text-amber-700 dark:text-amber-400">{t('blocked')}</span>
              )}
            </button>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {ordersOf(date).map((order) => (
                <OrderChip key={order.id} order={order} compact={false} />
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
