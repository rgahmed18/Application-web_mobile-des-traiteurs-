'use client';

import type { CashDeskItem } from '@traiteur/shared';
import {
  CheckIcon,
  ImageIcon,
  PhoneIcon,
  TriangleAlertIcon,
  WalletIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/layout/list-states';
import { PageHeader } from '@/components/layout/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ReasonDialog } from '@/features/orders/order-dialogs';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDateTime, formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

import { useCashDesk, useCashDeskAction } from './cash-desk-api';
import { openDocument } from './payments-api';

/**
 * Caisse livreurs : ce que chaque livreur a déclaré avoir encaissé à la livraison et n'a pas
 * encore remis. « Argent reçu » le fait compter (avec son reçu) ; « Refuser » l'annule.
 */
export function CashDeskView() {
  const t = useTranslations('cashDesk');
  const tm = useTranslations('assignments.cash.methods');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const describeError = useErrorMessage();
  const desk = useCashDesk();
  const action = useCashDeskAction();
  const [remitting, setRemitting] = useState<CashDeskItem | null>(null);
  const [rejecting, setRejecting] = useState<CashDeskItem | null>(null);
  const money = (cents: number) => formatMoney(cents, locale);
  const fail = (error: unknown) => toast.error(describeError(error));
  const data = desk.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {desk.isPending || !data ? (
        <Skeleton className="h-48 w-full" />
      ) : data.drivers.length === 0 ? (
        <EmptyState
          icon={WalletIcon}
          title={t('empty.title')}
          description={t('empty.description')}
        />
      ) : (
        <>
          <p className="text-lg" data-testid="cash-desk-total">
            {t('total')} : <span className="font-semibold tabular-nums">{money(data.total)}</span>
          </p>
          {data.drivers.map((driver) => (
            <Card key={driver.membershipId ?? driver.name} data-testid="cash-desk-driver">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                  <span dir="auto">{driver.name}</span>
                  {driver.phone && (
                    <Button asChild variant="ghost" size="icon" aria-label={t('call')}>
                      <a href={`tel:${driver.phone}`}>
                        <PhoneIcon aria-hidden />
                      </a>
                    </Button>
                  )}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {[
                    driver.cash > 0 && t('cashTotal', { amount: money(driver.cash) }),
                    driver.cheques > 0 && t('chequesTotal', { amount: money(driver.cheques) }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  {' · '}
                  <span className="font-semibold text-foreground tabular-nums">
                    {money(driver.total)}
                  </span>
                </p>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y rounded-lg border">
                  {driver.items.map((item) => (
                    <li
                      key={item.paymentId}
                      className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
                      data-testid="cash-desk-item"
                    >
                      <div className="flex flex-1 flex-col gap-0.5 text-sm">
                        <span className="flex flex-wrap items-center gap-x-2">
                          <Link
                            href={`/admin/orders/${item.orderId}`}
                            className="font-medium underline-offset-4 hover:underline"
                            dir="ltr"
                          >
                            {item.orderReference}
                          </Link>
                          <span dir="auto">{item.clientName}</span>
                          <span className="text-muted-foreground">
                            {formatLocalDate(item.eventDate)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {t('declaredAt', { date: formatDateTime(item.collectedAt, timeZone) })}
                        </span>
                        {item.expectedAmount !== null && item.expectedAmount !== item.amount && (
                          <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <TriangleAlertIcon className="size-4" aria-hidden />
                            {t('differs', { amount: money(item.expectedAmount) })}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col items-start gap-0.5 sm:items-end">
                        <span className="text-lg font-semibold tabular-nums">
                          {money(item.amount)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {tm(item.method)}
                          {item.reference && (
                            <>
                              {' '}
                              <span dir="ltr">n° {item.reference}</span>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 sm:ms-4">
                        {item.hasPhoto && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              openDocument(`/cash-desk/${item.paymentId}/cheque-photo`).catch(fail)
                            }
                          >
                            <ImageIcon aria-hidden />
                            {t('photo')}
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setRemitting(item)}>
                          <CheckIcon aria-hidden />
                          {t('remit')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRejecting(item)}>
                          <XIcon aria-hidden />
                          {t('reject')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </>
      )}

      <AlertDialog open={remitting !== null} onOpenChange={(open) => !open && setRemitting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remitDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {remitting &&
                t('remitDialog.description', {
                  amount: money(remitting.amount),
                  reference: remitting.orderReference,
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('remitDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={action.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!remitting) return;
                action.mutate(
                  { kind: 'remit', paymentId: remitting.paymentId },
                  {
                    onSuccess: () => {
                      toast.success(t('remitted'));
                      setRemitting(null);
                    },
                    onError: fail,
                  },
                );
              }}
            >
              {t('remitDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReasonDialog
        key={rejecting?.paymentId ?? 'none'}
        open={rejecting !== null}
        title={t('rejectDialog.title')}
        description={t('rejectDialog.description')}
        label={t('rejectDialog.reason')}
        confirmLabel={t('rejectDialog.confirm')}
        destructive
        pending={action.isPending}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason) => {
          if (!rejecting) return;
          action.mutate(
            { kind: 'reject', paymentId: rejecting.paymentId, reason },
            {
              onSuccess: () => {
                toast.success(t('rejected'));
                setRejecting(null);
              },
              onError: fail,
            },
          );
        }}
      />
    </div>
  );
}
