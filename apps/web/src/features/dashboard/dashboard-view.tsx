'use client';

import {
  CalendarCheckIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  HourglassIcon,
  type LucideIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission, useSession } from '@/features/auth/session-provider';
import { OrderStatusBadge } from '@/features/orders/order-ui';
import { useDashboard } from '@/features/orders/orders-api';
import { formatMoney } from '@/lib/format/money';

type CardKey = 'todayEvents' | 'upcomingEvents' | 'awaiting' | 'toClose' | 'monthRevenue';

interface DashboardCard {
  key: CardKey;
  icon: LucideIcon;
  href: string;
  value: string | null;
  hint: string;
  /** Mise en avant (commandes à traiter). */
  attention?: boolean;
}

function StatCard({ card }: { card: DashboardCard }) {
  const t = useTranslations('dashboard');
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card
        className="h-full transition-colors group-hover:bg-muted/40"
        data-testid={`card-${card.key}`}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base font-medium">{t(`cards.${card.key}`)}</CardTitle>
          <Icon
            className={
              card.attention
                ? 'size-5 text-amber-600 dark:text-amber-400'
                : 'size-5 text-muted-foreground'
            }
            aria-hidden
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {card.value === null ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <span
              className={
                card.key === 'monthRevenue'
                  ? 'text-2xl font-semibold tabular-nums [overflow-wrap:anywhere]'
                  : 'text-3xl font-semibold tabular-nums'
              }
              dir="ltr"
              data-testid="card-value"
            >
              {card.value}
            </span>
          )}
          <CardDescription>{card.hint}</CardDescription>
        </CardContent>
      </Card>
    </Link>
  );
}

/** Tableau de bord : activité du jour et des prochains jours, dans le fuseau du traiteur. */
export function DashboardView() {
  const t = useTranslations('dashboard');
  const tEvent = useTranslations('eventType');
  const locale = useLocale();
  const { user } = useSession();
  const canRead = usePermission()('orders.read');
  const dashboard = useDashboard(canRead);
  const data = dashboard.data;

  const cards: DashboardCard[] = [
    {
      key: 'todayEvents',
      icon: CalendarCheckIcon,
      href: '/admin/calendar?view=list',
      value: data ? String(data.todayOrders.length) : null,
      hint: t('hints.todayEvents'),
    },
    {
      key: 'upcomingEvents',
      icon: CalendarClockIcon,
      href: '/admin/orders?period=upcoming',
      value: data ? String(data.next7DaysCount) : null,
      hint: t('hints.upcomingEvents'),
    },
    {
      key: 'awaiting',
      icon: HourglassIcon,
      href: '/admin/orders?status=PENDING&period=all',
      value: data ? String(data.awaitingCount) : null,
      hint: t('hints.awaiting'),
      attention: (data?.awaitingCount ?? 0) > 0,
    },
    {
      key: 'toClose',
      icon: ClipboardCheckIcon,
      href: '/admin/orders?toClose=true',
      value: data ? String(data.toCloseCount) : null,
      hint: t('hints.toClose'),
      attention: (data?.toCloseCount ?? 0) > 0,
    },
    {
      key: 'monthRevenue',
      icon: WalletIcon,
      href: '/admin/orders?period=thisMonth',
      value: data ? formatMoney(data.monthRevenue.totalTtc, locale) : null,
      hint: t('hints.monthRevenue', { count: data?.monthRevenue.orderCount ?? 0 }),
    },
  ];

  return (
    <>
      <PageHeader
        title={user ? t('welcome', { name: user.firstName }) : t('title')}
        description={t('subtitle')}
      />
      {canRead && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {cards.map((card) => (
              <StatCard key={card.key} card={card} />
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('todayList')}</CardTitle>
            </CardHeader>
            <CardContent>
              {!data ? (
                <Skeleton className="h-16 w-full" />
              ) : data.todayOrders.length === 0 ? (
                <p className="text-muted-foreground">{t('noEventToday')}</p>
              ) : (
                <ul className="flex flex-col divide-y" data-testid="today-orders">
                  {data.todayOrders.map((order) => (
                    <li key={order.id}>
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/50"
                      >
                        <span className="w-14 font-semibold tabular-nums" dir="ltr">
                          {order.startTime}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{order.clientName}</span>
                          <span className="block text-sm text-muted-foreground">
                            {tEvent(order.eventType)} · {order.city}
                          </span>
                        </span>
                        <OrderStatusBadge status={order.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
