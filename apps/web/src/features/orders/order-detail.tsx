'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  type Availability,
  availableTransitions,
  formatTaxRate,
  type Order,
  type OrderHistoryEntry,
  type OrderStatus,
  PERMISSION_KEYS,
} from '@traiteur/shared';
import {
  ArrowLeftIcon,
  CalendarIcon,
  ClockIcon,
  FileTextIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  UserRoundCogIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { LoadError } from '@/components/layout/load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/session-provider';
import { clientName } from '@/features/clients/clients-api';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDate, formatDateTime, formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

import {
  availabilityConflict,
  ForceAvailabilityDialog,
  ReasonDialog,
  versionConflict,
  type VersionConflict,
  VersionConflictDialog,
} from './order-dialogs';
import { OrderStatusBadge, STATUS_STYLES } from './order-ui';
import { orderKeys, useOrder, useOrderHistory, useTransitionOrder } from './orders-api';

function Info({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="font-medium">{children}</div>
      </div>
    </div>
  );
}

/** Emplacement réservé (devis, paiements, personnel) : modules des prochaines étapes. */
function ComingSoonCard({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof FileTextIcon;
  title: string;
  hint: string;
}) {
  const t = useTranslations('orders.detail');
  return (
    <Card className="border-dashed">
      <CardHeader className="flex flex-row items-center gap-3">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
        <div className="flex-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{hint}</CardDescription>
        </div>
        <Badge variant="outline">{t('comingSoon')}</Badge>
      </CardHeader>
    </Card>
  );
}

const CHANGE_KEYS = [
  'schedule',
  'eventType',
  'venue',
  'guests',
  'lines',
  'venueName',
  'notes',
  'internalNotes',
  'client',
] as const;
const isChangeKey = (value: string): value is (typeof CHANGE_KEYS)[number] =>
  (CHANGE_KEYS as readonly string[]).includes(value);

/** Statuts atteignables manuellement (libellés d'action dans orders.transitions). */
const ACTION_TARGETS = [
  'CONFIRMED',
  'IN_PREPARATION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
] as const;
type ActionTarget = (typeof ACTION_TARGETS)[number];
const isActionTarget = (value: OrderStatus): value is ActionTarget =>
  (ACTION_TARGETS as readonly string[]).includes(value);

function History({ orderId, timeZone }: { orderId: string; timeZone: string }) {
  const t = useTranslations('orders.history');
  const tStatus = useTranslations('orderStatus');
  const history = useOrderHistory(orderId);
  const describe = (entry: OrderHistoryEntry) => {
    if (entry.kind === 'CREATED')
      return t('created', { status: tStatus(entry.toStatus ?? 'PENDING') });
    if (entry.kind === 'STATUS') {
      return t('status', {
        from: tStatus(entry.fromStatus ?? 'PENDING'),
        to: tStatus(entry.toStatus ?? 'PENDING'),
      });
    }
    return t('updated');
  };
  const dotFor = (entry: OrderHistoryEntry): string =>
    entry.toStatus ? STATUS_STYLES[entry.toStatus].dot : 'bg-muted-foreground';

  if (history.isPending) return <Skeleton className="h-32 w-full" />;
  const entries = history.data ?? [];
  if (entries.length === 0) return <p className="text-muted-foreground">{t('empty')}</p>;
  return (
    <ol className="flex flex-col gap-4" data-testid="order-history">
      {entries.map((entry) => {
        const changes = entry.changes.filter((change) => change !== 'availabilityForced');
        return (
          <li key={entry.id} className="flex gap-3">
            <span
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dotFor(entry)}`}
              aria-hidden
            />
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">{describe(entry)}</p>
              <p className="text-sm text-muted-foreground">
                <span dir="ltr">{formatDateTime(entry.at, timeZone)}</span>
                {entry.actorName && ` · ${t('by', { name: entry.actorName })}`}
              </p>
              {changes.length > 0 && (
                <p className="text-sm">
                  {changes
                    .map((change) => (isChangeKey(change) ? t(`changes.${change}`) : change))
                    .join(', ')}
                </p>
              )}
              {entry.reason && <p className="text-sm italic">« {entry.reason} »</p>}
              {entry.changes.includes('availabilityForced') && (
                <Badge variant="outline" className="self-start">
                  {t('forced')}
                </Badge>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Boutons de changement de statut, selon la machine à états et les droits de l'utilisateur. */
function StatusActions({ order, timeZone }: { order: Order; timeZone: string }) {
  const t = useTranslations('orders');
  const tStatus = useTranslations('orderStatus');
  const can = usePermission();
  const describeError = useErrorMessage();
  const queryClient = useQueryClient();
  const transition = useTransitionOrder();
  const [reasonFor, setReasonFor] = useState<'CANCELLED' | 'PENDING' | null>(null);
  const [force, setForce] = useState<{ availability: Availability; to: OrderStatus } | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);

  const permissions = new Set(PERMISSION_KEYS.filter((key) => can(key)));
  const targets = availableTransitions(order.status, permissions).map((rule) => rule.to);

  const run = (to: OrderStatus, options: { reason?: string; forceAvailability?: boolean } = {}) => {
    transition.mutate(
      {
        id: order.id,
        input: {
          to,
          version: order.version,
          reason: options.reason ?? null,
          forceAvailability: options.forceAvailability ?? false,
        },
      },
      {
        onSuccess: (updated) => {
          setReasonFor(null);
          toast.success(t('transitions.done', { status: tStatus(updated.status) }));
        },
        onError: (error) => {
          const availability = availabilityConflict(error);
          if (availability) return setForce({ availability, to });
          const stale = versionConflict(error);
          if (stale) return setConflict(stale);
          toast.error(describeError(error));
        },
      },
    );
  };

  const forward = targets.filter(isActionTarget);
  return (
    <>
      <div className="flex flex-wrap gap-2" data-testid="status-actions">
        {forward.map((to, index) => (
          <Button
            key={to}
            variant={index === 0 ? 'default' : 'outline'}
            disabled={transition.isPending}
            onClick={() => run(to)}
          >
            {t(`transitions.${to}`)}
          </Button>
        ))}
        {targets.includes('PENDING') && (
          <Button
            variant="outline"
            disabled={transition.isPending}
            onClick={() => setReasonFor('PENDING')}
          >
            {t('transitions.PENDING')}
          </Button>
        )}
        {targets.includes('CANCELLED') && (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={transition.isPending}
            onClick={() => setReasonFor('CANCELLED')}
          >
            {t('transitions.CANCELLED')}
          </Button>
        )}
      </div>

      <ReasonDialog
        key={reasonFor ?? 'none'}
        open={reasonFor !== null}
        title={
          reasonFor === 'CANCELLED'
            ? t('cancel.title', { reference: order.reference })
            : t('unconfirm.title')
        }
        description={
          reasonFor === 'CANCELLED' ? t('cancel.description') : t('unconfirm.description')
        }
        warning={reasonFor === 'CANCELLED' ? t('cancel.refundWarning') : undefined}
        label={reasonFor === 'CANCELLED' ? t('cancel.reason') : t('unconfirm.reason')}
        placeholder={reasonFor === 'CANCELLED' ? t('cancel.placeholder') : undefined}
        confirmLabel={reasonFor === 'CANCELLED' ? t('cancel.confirm') : t('unconfirm.confirm')}
        destructive={reasonFor === 'CANCELLED'}
        pending={transition.isPending}
        onCancel={() => setReasonFor(null)}
        onConfirm={(reason) => reasonFor && run(reasonFor, { reason })}
      />
      <ForceAvailabilityDialog
        availability={force?.availability ?? null}
        onCancel={() => setForce(null)}
        onConfirm={() => {
          if (force) run(force.to, { forceAvailability: true });
          setForce(null);
        }}
      />
      <VersionConflictDialog
        conflict={conflict}
        timeZone={timeZone}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null);
          void queryClient.invalidateQueries({ queryKey: orderKeys.detail(order.id) });
          void queryClient.invalidateQueries({ queryKey: orderKeys.history(order.id) });
        }}
      />
    </>
  );
}

export function OrderDetail({ orderId }: { orderId: string }) {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const tEvent = useTranslations('eventType');
  const locale = useLocale();
  const can = usePermission();
  const timeZone = useTimeZone();
  const order = useOrder(orderId);

  if (order.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!order.data) return <LoadError error={order.error} backHref="/admin/orders" />;

  const data = order.data;
  const unit = (line: Order['lines'][number]) => formatMoney(line.unitPrice, locale);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button asChild variant="link" className="self-start px-0">
          <Link href="/admin/orders">
            <ArrowLeftIcon className="rtl:rotate-180" aria-hidden />
            {tc('back')}
          </Link>
        </Button>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold sm:text-3xl" dir="ltr">
                {data.reference}
              </h1>
              <OrderStatusBadge status={data.status} className="text-base" />
            </div>
            <p className="text-muted-foreground">
              {tEvent(data.eventType)} · {clientName(data.client)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusActions order={data} timeZone={timeZone} />
            {can('orders.write') && (
              <Button asChild variant="outline">
                <Link href={`/admin/orders/${data.id}/edit`}>
                  <PencilIcon aria-hidden />
                  {t('detail.edit')}
                </Link>
              </Button>
            )}
          </div>
        </div>
        {data.status === 'CANCELLED' && data.cancelledAt && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {t('detail.cancelled', {
              date: formatDate(data.cancelledAt, timeZone),
              reason: data.cancellationReason ?? '—',
            })}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
              <Info icon={CalendarIcon} label={t('detail.event')}>
                <span dir="ltr">{formatLocalDate(data.eventDate)}</span>
              </Info>
              <Info icon={ClockIcon} label={t('form.event.startTime')}>
                <span dir="ltr">
                  {data.startTime}
                  {data.endTime && ` – ${data.endTime}`}
                </span>{' '}
                {data.endsNextDay && (
                  <span className="text-sm text-muted-foreground">{t('detail.nextDay')}</span>
                )}
              </Info>
              <Info icon={UsersIcon} label={t('detail.guests')}>
                {t('guests', { count: data.guestCount })}
              </Info>
              <Info icon={MapPinIcon} label={t('detail.venue')}>
                {data.venueName && <span className="block">{data.venueName}</span>}
                <span className="block font-normal">
                  {data.venueAddress}, {data.city}
                </span>
              </Info>
              <Info icon={PhoneIcon} label={t('detail.client')}>
                {can('clients.read') ? (
                  <Link
                    href={`/admin/clients/${data.client.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {clientName(data.client)}
                  </Link>
                ) : (
                  clientName(data.client)
                )}
                <span className="block font-normal" dir="ltr">
                  <a href={`tel:${data.client.phone}`}>{data.client.phone}</a>
                </span>
              </Info>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('detail.lines')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y" data-testid="detail-lines">
                {data.lines.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{line.label}</p>
                      <p className="text-sm text-muted-foreground">
                        <span dir="ltr">
                          {line.quantity} × {unit(line)}
                        </span>
                        {' · '}
                        {t('form.lines.taxRate')} {formatTaxRate(line.taxRateBps)}
                        {line.discount > 0 &&
                          ` · ${t('detail.discount', { amount: formatMoney(line.discount, locale) })}`}
                      </p>
                    </div>
                    <span className="font-medium tabular-nums" dir="ltr">
                      {formatMoney(data.priceMode === 'TTC' ? line.totalTtc : line.totalHt, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('detail.notes')}</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-line">
                {data.notes ?? t('detail.noNotes')}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('detail.internalNotes')}</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-line">
                {data.internalNotes ?? t('detail.noNotes')}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4">
            <ComingSoonCard
              icon={FileTextIcon}
              title={t('detail.quotes')}
              hint={t('detail.quotesHint')}
            />
            <ComingSoonCard
              icon={WalletIcon}
              title={t('detail.payments')}
              hint={t('detail.paymentsHint')}
            />
            <ComingSoonCard
              icon={UserRoundCogIcon}
              title={t('detail.staff')}
              hint={t('detail.staffHint')}
            />
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('detail.totals')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t('form.totals.ht')}</dt>
                  <dd className="tabular-nums" dir="ltr">
                    {formatMoney(data.totalHt, locale)}
                  </dd>
                </div>
                {data.taxBreakdown.map((entry) => (
                  <div key={entry.taxRateBps} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      {t('form.totals.tax', { rate: formatTaxRate(entry.taxRateBps) })}
                    </dt>
                    <dd className="tabular-nums" dir="ltr">
                      {formatMoney(entry.taxAmount, locale)}
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 border-t pt-2 text-lg font-semibold">
                  <dt>{t('form.totals.ttc')}</dt>
                  <dd className="tabular-nums" dir="ltr" data-testid="detail-total-ttc">
                    {formatMoney(data.totalTtc, locale)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('detail.history')}</CardTitle>
              <CardDescription>
                {t('detail.createdAt', { date: formatDate(data.createdAt, timeZone) })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <History orderId={data.id} timeZone={timeZone} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
