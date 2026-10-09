'use client';

import { type Order, todayInTimeZone } from '@traiteur/shared';
import { BanIcon, FileTextIcon, PencilIcon, PlusIcon, Undo2Icon, WalletIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/session-provider';
import { ReasonDialog } from '@/features/orders/order-dialogs';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';

import { DepositDialog, PaymentDialog } from './payment-dialogs';
import { openDocument, useOrderPayments, useVoidPayment } from './payments-api';

/** Paiements de la commande : échéancier, encaissements et reçus, remboursements. */
export function PaymentsCard({ order, timeZone }: { order: Order; timeZone: string }) {
  const t = useTranslations('payments');
  const locale = useLocale();
  const can = usePermission();
  const describeError = useErrorMessage();
  const payments = useOrderPayments(order.id);
  const voidPayment = useVoidPayment(order.id);
  const [dialog, setDialog] = useState<'payment' | 'refund' | 'deposit' | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const today = todayInTimeZone(timeZone);
  const cancelled = order.status === 'CANCELLED';
  const money = (cents: number) => formatMoney(cents, locale);

  if (payments.isPending) return <Skeleton className="h-64 w-full" />;
  const data = payments.data;
  if (!data) return null;
  const { schedule } = data;

  return (
    <Card data-testid="payments-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <WalletIcon className="size-5 text-muted-foreground" aria-hidden />
          {t('title')}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {can('payments.record') && !cancelled && schedule.remaining > 0 && (
            <Button size="sm" onClick={() => setDialog('payment')}>
              <PlusIcon aria-hidden />
              {t('record')}
            </Button>
          )}
          {can('payments.refund') && schedule.paid > 0 && (
            <Button size="sm" variant="outline" onClick={() => setDialog('refund')}>
              <Undo2Icon aria-hidden />
              {t('refund')}
            </Button>
          )}
          {can('orders.write') && !cancelled && (
            <Button size="sm" variant="ghost" onClick={() => setDialog('deposit')}>
              <PencilIcon aria-hidden />
              {t('editDeposit')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-3 gap-3 text-center" data-testid="payments-summary">
          <div className="rounded-lg bg-muted/50 p-3">
            <dt className="text-sm text-muted-foreground">{t('total')}</dt>
            <dd className="font-semibold tabular-nums" dir="ltr">
              {money(order.totalTtc)}
            </dd>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <dt className="text-sm text-muted-foreground">{t('paid')}</dt>
            <dd className="font-semibold tabular-nums" dir="ltr" data-testid="payments-paid">
              {money(schedule.paid)}
            </dd>
          </div>
          <div
            className={cn(
              'rounded-lg p-3',
              schedule.overdueAmount > 0
                ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200'
                : 'bg-muted/50',
            )}
          >
            <dt className="text-sm opacity-80">{t('remaining')}</dt>
            <dd className="font-semibold tabular-nums" dir="ltr" data-testid="payments-remaining">
              {money(schedule.remaining)}
            </dd>
          </div>
        </dl>
        {schedule.overdueAmount > 0 && schedule.overdueSince && (
          <p className="font-medium text-red-700 dark:text-red-300">
            {t('overdueSince', {
              amount: money(schedule.overdueAmount),
              date: formatLocalDate(schedule.overdueSince),
            })}
          </p>
        )}

        {schedule.installments.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{t('schedule')}</p>
            <ul className="flex flex-col divide-y rounded-lg border" data-testid="installments">
              {schedule.installments.map((item) => (
                <li key={item.kind} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
                  <span className="min-w-24 font-medium">{t(`installments.${item.kind}`)}</span>
                  <span className="tabular-nums" dir="ltr">
                    {money(item.amount)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {item.dueDate
                      ? t('dueOn', { date: formatLocalDate(item.dueDate) })
                      : t('dueAtConfirmation')}
                  </span>
                  <span className="ms-auto">
                    {item.remaining === 0 ? (
                      <Badge variant="secondary">{t('installmentPaid')}</Badge>
                    ) : item.overdue ? (
                      <Badge variant="destructive">{t('overdue')}</Badge>
                    ) : item.paid > 0 ? (
                      <Badge variant="outline">
                        {t('installmentPartial', { amount: money(item.remaining) })}
                      </Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              {data.depositLocked
                ? t('depositLocked', { amount: money(data.depositAmount) })
                : t('depositPlanned', { amount: money(data.depositAmount) })}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="font-medium">{t('list')}</p>
          {data.payments.length === 0 ? (
            <p className="text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border" data-testid="payments-list">
              {data.payments.map((payment) => (
                <li
                  key={payment.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-4 gap-y-1 p-3',
                    payment.voided && 'opacity-60',
                  )}
                >
                  <span className="text-sm tabular-nums" dir="ltr">
                    {formatLocalDate(payment.paidOn)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {t(`types.${payment.type}`)} · {t(`methods.${payment.method}`)}
                      {payment.reference && (
                        <span className="text-muted-foreground" dir="auto">
                          {' '}
                          · {payment.reference}
                        </span>
                      )}
                    </span>
                    {payment.voided && payment.voidReason && (
                      <span className="block text-sm text-destructive">
                        {t('voidedReason', { reason: payment.voidReason })}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn('font-semibold tabular-nums', payment.voided && 'line-through')}
                    dir="ltr"
                  >
                    {payment.type === 'REFUND' ? '−' : ''}
                    {money(payment.amount)}
                  </span>
                  {payment.voided && <Badge variant="outline">{t('voided')}</Badge>}
                  {payment.receiptNumber && can('payments.read') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        openDocument(`/orders/${order.id}/payments/${payment.id}/receipt`).catch(
                          (error: unknown) => toast.error(describeError(error)),
                        )
                      }
                    >
                      <FileTextIcon aria-hidden />
                      <span dir="ltr">{payment.receiptNumber}</span>
                    </Button>
                  )}
                  {can('payments.refund') && !payment.voided && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('void')}
                      title={t('void')}
                      onClick={() => setVoiding(payment.id)}
                    >
                      <BanIcon aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.refunded > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('refunded', { amount: money(data.refunded) })}
            </p>
          )}
          {data.cancellationFee > 0 && (
            <p className="text-sm font-medium">
              {t('cancellationFee', { amount: money(data.cancellationFee) })}
            </p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t('onlineSoon')}</p>
      </CardContent>

      {(dialog === 'payment' || dialog === 'refund') && (
        <PaymentDialog
          orderId={order.id}
          mode={dialog}
          suggested={
            dialog === 'refund'
              ? schedule.paid
              : (schedule.installments.find((item) => item.remaining > 0)?.remaining ??
                schedule.remaining)
          }
          today={today}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'deposit' && (
        <DepositDialog
          orderId={order.id}
          current={data.depositAmount}
          onClose={() => setDialog(null)}
        />
      )}
      <ReasonDialog
        key={voiding ?? 'none'}
        open={voiding !== null}
        title={t('voidDialog.title')}
        description={t('voidDialog.description')}
        label={t('voidDialog.reason')}
        confirmLabel={t('voidDialog.confirm')}
        destructive
        pending={voidPayment.isPending}
        onCancel={() => setVoiding(null)}
        onConfirm={(reason) => {
          if (!voiding) return;
          voidPayment.mutate(
            { paymentId: voiding, input: { reason } },
            {
              onSuccess: () => {
                toast.success(t('voidDialog.done'));
                setVoiding(null);
              },
              onError: (error) => toast.error(describeError(error)),
            },
          );
        }}
      />
    </Card>
  );
}
