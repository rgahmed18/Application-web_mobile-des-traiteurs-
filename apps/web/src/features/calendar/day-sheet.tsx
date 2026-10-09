'use client';

import type { CalendarDay, CalendarOrder } from '@traiteur/shared';
import { BanIcon, PlusIcon, UnlockIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { usePermission } from '@/features/auth/session-provider';
import { OrderStatusBadge } from '@/features/orders/order-ui';
import { useBlockDate, useUnblockDate } from '@/features/orders/orders-api';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatLocalDate, formatLongDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

import { LoadIndicator } from './load-indicator';

interface DaySheetProps {
  day: CalendarDay | null;
  orders: CalendarOrder[];
  capacity: number | null;
  onClose: () => void;
}

/** Jour choisi dans le calendrier : ses commandes, sa charge, son blocage, et une nouvelle commande. */
export function DaySheet({ day, orders, capacity, onClose }: DaySheetProps) {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const tEvent = useTranslations('eventType');
  const locale = useLocale();
  const can = usePermission();
  const describeError = useErrorMessage();
  const block = useBlockDate();
  const unblock = useUnblockDate();
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');

  const date = day?.date ?? '';
  const ofDay = orders.filter((order) => order.date === date);

  return (
    <Sheet open={day !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={locale === 'ar' ? 'left' : 'right'}
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="text-xl first-letter:uppercase">
            {day ? formatLongDate(date, locale) : ''}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              {day && <LoadIndicator day={day} capacity={capacity} />}
              {day?.blocked && (
                <span className="text-amber-700 dark:text-amber-400">
                  {t('blocked')}
                  {day.blockedReason && ` — ${day.blockedReason}`}
                </span>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            {can('orders.create') && (
              <Button asChild>
                <Link href={`/admin/orders/new?date=${date}`}>
                  <PlusIcon aria-hidden />
                  {t('newOrder')}
                </Link>
              </Button>
            )}
            {can('calendar.manage') &&
              day &&
              (day.blocked ? (
                <Button
                  variant="outline"
                  disabled={unblock.isPending}
                  onClick={() =>
                    unblock.mutate(date, {
                      onSuccess: () => toast.success(t('unblockedToast')),
                      onError: (error) => toast.error(describeError(error)),
                    })
                  }
                >
                  <UnlockIcon aria-hidden />
                  {t('unblock')}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setBlocking(true)}>
                  <BanIcon aria-hidden />
                  {t('block')}
                </Button>
              ))}
          </div>

          {ofDay.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">{t('noOrders')}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border" data-testid="day-orders">
              {ofDay.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="flex flex-col gap-1 p-3 hover:bg-muted/50"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold tabular-nums" dir="ltr">
                        {order.startTime}
                        {order.endTime && ` – ${order.endTime}`}
                      </span>
                      <OrderStatusBadge status={order.status} />
                    </span>
                    <span className="font-medium">{order.clientName}</span>
                    <span className="text-sm text-muted-foreground">
                      {tEvent(order.eventType)} · {order.guestCount} · {order.city} ·{' '}
                      <span dir="ltr">{formatMoney(order.totalTtc, locale)}</span>
                    </span>
                    <span className="text-xs text-muted-foreground" dir="ltr">
                      {order.reference}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>

      <Dialog open={blocking} onOpenChange={setBlocking}>
        <DialogContent className="sm:max-w-md">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              block.mutate(
                { date, reason: reason.trim() === '' ? null : reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(t('blockedToast'));
                    setBlocking(false);
                    setReason('');
                  },
                  onError: (error) => toast.error(describeError(error)),
                },
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('blockTitle', { date: formatLocalDate(date) })}</DialogTitle>
              <DialogDescription className="text-base">{t('blockDescription')}</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-2">
              <span className="font-medium">{t('blockReason')}</span>
              <Input
                value={reason}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setBlocking(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" size="lg" disabled={block.isPending}>
                {t('block')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
