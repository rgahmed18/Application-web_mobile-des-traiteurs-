'use client';

import {
  BanknoteIcon,
  CalendarCheckIcon,
  CircleAlertIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  HourglassIcon,
  TriangleAlertIcon,
  UserRoundXIcon,
  type LucideIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission, useSession } from '@/features/auth/session-provider';
import { OrderStatusBadge } from '@/features/orders/order-ui';
import { useDashboard } from '@/features/orders/orders-api';
import { formatMoney } from '@/lib/format/money';
import { useLocalized } from '@/features/catalog/use-localized';

type CardKey =
  | 'todayEvents'
  | 'upcomingEvents'
  | 'awaiting'
  | 'toClose'
  | 'monthRevenue'
  | 'monthCollected'
  | 'unpaid';

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
                card.key === 'monthRevenue' ||
                card.key === 'monthCollected' ||
                card.key === 'unpaid'
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
  const localized = useLocalized();
  const locale = useLocale();
  const { user, status } = useSession();
  const can = usePermission();
  const canRead = can('orders.read');
  const router = useRouter();
  // Équipe de terrain et livreurs : leur page d'accueil est la liste de leurs missions
  const fieldStaff = status === 'authenticated' && !canRead && can('assignments.read_own');
  useEffect(() => {
    if (fieldStaff) router.replace('/admin/missions');
  }, [fieldStaff, router]);
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
    {
      key: 'monthCollected',
      icon: BanknoteIcon,
      href: '/admin/orders?period=all&payment=unpaid',
      value: data ? formatMoney(data.monthCollected.amount, locale) : null,
      hint: t('hints.monthCollected', { count: data?.monthCollected.count ?? 0 }),
    },
    {
      key: 'unpaid',
      icon: CircleAlertIcon,
      href: '/admin/orders?period=all&payment=overdue',
      value: data ? formatMoney(data.unpaid.amount, locale) : null,
      hint: t('hints.unpaid', { count: data?.unpaid.count ?? 0 }),
      attention: (data?.unpaid.count ?? 0) > 0,
    },
  ];

  return (
    <>
      <PageHeader
        title={
          user
            ? t('welcome', {
                // Super admin entré chez le traiteur : son nom complet, comme dans la console
                name: user.isSuperAdmin
                  ? `${user.firstName} ${user.lastName}`.trim()
                  : user.firstName,
              })
            : t('title')
        }
        description={t('subtitle')}
      />
      {canRead && (
        <>
          {data && data.staffAlerts.declined + data.staffAlerts.unconfirmed > 0 && (
            <Link
              href="/admin/staff?tab=planning"
              className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
              data-testid="staff-alerts"
            >
              <UserRoundXIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>
                {data.staffAlerts.declined > 0 && (
                  <span className="block font-semibold">
                    {t('staffAlerts.declined', { count: data.staffAlerts.declined })}
                  </span>
                )}
                {data.staffAlerts.unconfirmed > 0 && (
                  <span className="block font-semibold">
                    {t('staffAlerts.unconfirmed', { count: data.staffAlerts.unconfirmed })}
                  </span>
                )}
                <span className="block text-sm">{t('staffAlerts.hint')}</span>
              </span>
            </Link>
          )}
          {(data?.quotesToConfirm ?? 0) > 0 && (
            <Link
              href="/admin/orders?status=QUOTED&period=all"
              className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
              data-testid="quotes-to-confirm"
            >
              <TriangleAlertIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>
                <span className="block font-semibold">
                  {t('quotesToConfirm.title', { count: data?.quotesToConfirm ?? 0 })}
                </span>
                <span className="block text-sm">{t('quotesToConfirm.hint')}</span>
              </span>
            </Link>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                            {localized(order.eventTypeName)} · {order.city}
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
