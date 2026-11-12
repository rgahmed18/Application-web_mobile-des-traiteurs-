'use client';

import { type ClientOrderSummary, type ClientQuoteSummary, lineLabelText } from '@traiteur/shared';
import {
  ArrowRightIcon,
  CalendarIcon,
  DownloadIcon,
  FileTextIcon,
  InboxIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { EmptyState } from '@/components/layout/list-states';
import { LoadError } from '@/components/layout/load-error';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalized } from '@/features/catalog/use-localized';

import { OrderStatusBadge } from '@/features/orders/order-ui';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDate, formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

import {
  openClientDocument,
  useCancelRequest,
  useClientDashboard,
  useClientOrder,
  useClientOrders,
} from '../client-api';

function useMoney() {
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  return (cents: number) => formatMoney(cents, locale);
}

/** Ligne d'une demande : référence, statut, événement, date, invités. */
function OrderRow({ order }: { order: ClientOrderSummary }) {
  const t = useTranslations('site.space');
  const localized = useLocalized();
  return (
    <li>
      <Link
        href={`/espace/demandes/${order.id}`}
        className="flex flex-col gap-1 p-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4"
        data-testid="client-order-row"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium" dir="ltr">
              {order.reference}
            </span>
            <OrderStatusBadge status={order.status} />
            {order.quoteToAnswer && <Badge>{t('quoteToAnswer')}</Badge>}
          </span>
          <span className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{localized(order.eventTypeName)}</span>
            <span className="inline-flex items-center gap-1">
              <CalendarIcon className="size-4" aria-hidden />
              {formatLocalDate(order.eventDate)} · {order.startTime}
            </span>
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="size-4" aria-hidden />
              {t('guests', { count: order.guestCount })}
            </span>
          </span>
        </div>
        <ArrowRightIcon className="hidden size-4 text-muted-foreground sm:block rtl:rotate-180" />
      </Link>
    </li>
  );
}

function QuoteRow({ quote }: { quote: ClientQuoteSummary }) {
  const t = useTranslations('site.space');
  const money = useMoney();
  return (
    <li>
      <Link
        href={`/espace/devis/${quote.id}`}
        className="flex flex-wrap items-center gap-3 p-3 hover:bg-muted/50"
        data-testid="client-quote-row"
      >
        <span className="font-medium" dir="ltr">
          {quote.reference} v{quote.version}
        </span>
        <Badge variant={quote.status === 'SENT' ? 'default' : 'secondary'}>
          {t(`quoteStatus.${quote.status}`)}
        </Badge>
        <span className="text-sm text-muted-foreground" dir="ltr">
          {quote.orderReference}
        </span>
        <span className="ms-auto font-medium" dir="ltr">
          {money(quote.totalTtc)}
        </span>
      </Link>
    </li>
  );
}

/** Accueil : demandes en cours, devis à traiter, prochaine échéance. */
export function SpaceDashboard() {
  const t = useTranslations('site.space');
  const money = useMoney();
  const dashboard = useClientDashboard();
  if (dashboard.isPending) return <Skeleton className="h-64 w-full" />;
  if (!dashboard.data) return <LoadError error={dashboard.error} backHref="/" />;
  const { activeOrders, quotesToAnswer, nextPayment } = dashboard.data;
  return (
    <div className="flex flex-col gap-4">
      {quotesToAnswer.length > 0 && (
        <Card data-testid="dashboard-quotes">
          <CardHeader>
            <CardTitle className="text-lg">{t('dashboard.quotes')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {quotesToAnswer.map((quote) => (
                <QuoteRow key={quote.id} quote={quote} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {nextPayment && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <WalletIcon className="size-5 text-muted-foreground" aria-hidden />
              {t('dashboard.nextPayment')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <span className="text-xl font-semibold" dir="ltr">
              {money(nextPayment.remaining)}
            </span>
            <span className="text-muted-foreground">
              {t(`installments.${nextPayment.kind}`)} · {nextPayment.orderReference}
              {nextPayment.dueDate
                ? ` · ${t('dueOn', { date: formatLocalDate(nextPayment.dueDate) })}`
                : ''}
            </span>
            {nextPayment.overdue && <Badge variant="destructive">{t('overdue')}</Badge>}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{t('dashboard.active')}</CardTitle>
          <Button asChild size="sm">
            <Link href="/catalogue">{t('newRequest')}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {activeOrders.length === 0 ? (
            <p className="text-muted-foreground">{t('dashboard.noActive')}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {activeOrders.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Toutes les demandes et commandes du client chez ce traiteur. */
export function SpaceOrders() {
  const t = useTranslations('site.space');
  const orders = useClientOrders();
  if (orders.isPending) return <Skeleton className="h-64 w-full" />;
  if (!orders.data) return <LoadError error={orders.error} backHref="/espace" />;
  if (orders.data.length === 0) {
    return (
      <EmptyState
        icon={InboxIcon}
        title={t('orders.empty')}
        description={t('orders.emptyHint')}
        action={
          <Button asChild>
            <Link href="/catalogue">{t('newRequest')}</Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className="divide-y rounded-xl border" data-testid="client-orders">
      {orders.data.map((order) => (
        <OrderRow key={order.id} order={order} />
      ))}
    </ul>
  );
}

/** Une demande : lignes, historique, devis, factures, paiements ; annulation si en attente. */
export function SpaceOrderDetail({ id }: { id: string }) {
  const t = useTranslations('site.space');
  const ts = useTranslations('orderStatus');
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  const localized = useLocalized();
  const money = useMoney();
  const describeError = useErrorMessage();
  const order = useClientOrder(id);
  const cancel = useCancelRequest();
  if (order.isPending) return <Skeleton className="h-96 w-full" />;
  if (!order.data) return <LoadError error={order.error} backHref="/espace/demandes" />;
  const data = order.data;

  const download = (path: string) =>
    openClientDocument(path).catch((error: unknown) => toast.error(describeError(error)));

  return (
    <article className="flex flex-col gap-4" data-testid="client-order">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold" dir="ltr">
          {data.reference}
        </h2>
        <OrderStatusBadge status={data.status} testId="client-order-status" />
        {data.cancellable && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="ms-auto">
                {t('order.cancel')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('order.cancelTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('order.cancelHint')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('order.keep')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    cancel
                      .mutateAsync(data.id)
                      .then(() => toast.success(t('order.cancelled')))
                      .catch((error: unknown) => toast.error(describeError(error)))
                  }
                >
                  {t('order.confirmCancel')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </header>

      <Card>
        <CardContent className="grid gap-2 pt-6 sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">{t('order.event')} : </span>
            {localized(data.eventTypeName)}
          </p>
          <p dir="auto">
            <span className="text-muted-foreground">{t('order.date')} : </span>
            {formatLocalDate(data.eventDate)} · {data.startTime}
            {data.endTime ? ` – ${data.endTime}` : ''}
          </p>
          <p>
            <span className="text-muted-foreground">{t('order.guests')} : </span>
            {data.guestCount}
          </p>
          <p dir="auto">
            <span className="text-muted-foreground">{t('order.venue')} : </span>
            {[data.venueName, data.venueAddress, data.city].filter(Boolean).join(', ')}
          </p>
          {data.notes && (
            <p className="sm:col-span-2" dir="auto">
              <span className="text-muted-foreground">{t('order.notes')} : </span>
              {data.notes}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('order.lines')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y" data-testid="client-order-lines">
            {data.lines.map((line, index) => (
              <li key={index} className="flex justify-between gap-3 py-2">
                <span dir="auto">
                  {lineLabelText(line.label, locale)}
                  {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                </span>
                <span dir="ltr">{money(line.totalTtc)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 py-2 font-semibold">
              <span>{t('order.total')}</span>
              <span dir="ltr">{money(data.totalTtc)}</span>
            </li>
          </ul>
          {data.status === 'PENDING' && (
            <p className="pt-2 text-sm text-muted-foreground">{t('order.estimateHint')}</p>
          )}
        </CardContent>
      </Card>

      {data.quotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('sections.quotes')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {data.quotes.map((quote) => (
                <QuoteRow key={quote.id} quote={quote} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(data.invoices.length > 0 || data.payments.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('order.documents')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm">
              {t('order.paid', { paid: money(data.paid), remaining: money(data.remaining) })}
            </p>
            <ul className="flex flex-col gap-2">
              {data.invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void download(`/client/invoices/${invoice.id}/pdf`)}
                  >
                    <FileTextIcon aria-hidden />
                    {invoice.number}
                  </Button>
                </li>
              ))}
              {data.payments
                .filter((payment) => payment.receiptNumber)
                .map((payment) => (
                  <li key={payment.id}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void download(`/client/payments/${payment.id}/receipt`)}
                    >
                      <DownloadIcon aria-hidden />
                      {payment.receiptNumber} · {money(payment.amount)}
                    </Button>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('order.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2" data-testid="client-order-history">
            {data.history.map((entry, index) => (
              <li key={index} className="flex flex-wrap gap-2 text-sm">
                <span className="text-muted-foreground" dir="ltr">
                  {formatDate(entry.at)}
                </span>
                <span>{ts(entry.toStatus)}</span>
                <span className="text-muted-foreground">
                  {entry.byClient ? t('order.byYou') : t('order.byTraiteur')}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </article>
  );
}
