'use client';

import { INVOICE_KINDS, type Invoice, type InvoiceKind, type Order } from '@traiteur/shared';
import { FileTextIcon, ReceiptTextIcon, Undo2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/session-provider';
import { ReasonDialog } from '@/features/orders/order-dialogs';
import { openDocument } from '@/features/payments/payments-api';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';

import { useCreditNote, useIssueInvoice, useOrderInvoicing } from './invoices-api';

/** Libellé d'un document : « Facture d'acompte », « Avoir »… */
export function useInvoiceTitle() {
  const t = useTranslations('invoices');
  return (invoice: Pick<Invoice, 'type' | 'kind'>) =>
    invoice.type === 'CREDIT_NOTE' ? t('creditNote') : t(`kinds.${invoice.kind}`);
}

/** Factures et avoirs de la commande ; émission datée du jour, numéro définitif. */
export function InvoicesCard({ order }: { order: Order }) {
  const t = useTranslations('invoices');
  const locale = useLocale();
  const can = usePermission();
  const describeError = useErrorMessage();
  const title = useInvoiceTitle();
  const invoicing = useOrderInvoicing(order.id);
  const issue = useIssueInvoice(order.id);
  const credit = useCreditNote(order.id);
  const [issuing, setIssuing] = useState<InvoiceKind | null>(null);
  const [crediting, setCrediting] = useState<Invoice | null>(null);
  const money = (cents: number) => formatMoney(cents, locale);

  if (invoicing.isPending) return <Skeleton className="h-40 w-full" />;
  if (isApiError(invoicing.error) && invoicing.error.code === 'FEATURE_DISABLED') {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('notInPlan')}</p>
        </CardHeader>
      </Card>
    );
  }
  const data = invoicing.data;
  if (!data) return null;
  const available = INVOICE_KINDS.filter((kind) => data.available[kind] !== null);
  const amountOf = (kind: InvoiceKind) => data.available[kind] ?? 0;

  return (
    <Card data-testid="invoices-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ReceiptTextIcon className="size-5 text-muted-foreground" aria-hidden />
          {t('title')}
        </CardTitle>
        {can('invoices.issue') && available.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {available.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={kind === 'TOTAL' || kind === 'BALANCE' ? 'default' : 'outline'}
                onClick={() => setIssuing(kind)}
              >
                {t(`issue.${kind}`)}
              </Button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.invoices.length === 0 ? (
          <p className="text-muted-foreground">
            {available.length > 0 ? t('empty') : t('emptyNotConfirmed')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border" data-testid="invoices-list">
            {data.invoices.map((invoice) => {
              const creditNote = invoice.type === 'CREDIT_NOTE';
              const fullyCredited = !creditNote && invoice.totalTtc + invoice.creditedTtc <= 0;
              return (
                <li
                  key={invoice.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-4 gap-y-1 p-3',
                    fullyCredited && 'opacity-70',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {title(invoice)}{' '}
                      <span dir="ltr" className="text-muted-foreground">
                        {invoice.number}
                      </span>
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {t('issuedOn', { date: formatLocalDate(invoice.issuedOn) })}
                      {invoice.originalNumber &&
                        ` · ${t('creditFor', { number: invoice.originalNumber })}`}
                      {invoice.reason && ` · ${invoice.reason}`}
                    </span>
                  </span>
                  {invoice.creditedTtc < 0 && (
                    <Badge variant="outline">
                      {fullyCredited ? t('credited') : t('partlyCredited')}
                    </Badge>
                  )}
                  <span
                    className={cn(
                      'font-semibold tabular-nums',
                      creditNote && 'text-red-700 dark:text-red-300',
                    )}
                    dir="ltr"
                  >
                    {money(invoice.totalTtc)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      openDocument(`/invoices/${invoice.id}/pdf`).catch((error: unknown) =>
                        toast.error(describeError(error)),
                      )
                    }
                  >
                    <FileTextIcon aria-hidden />
                    PDF
                  </Button>
                  {can('invoices.credit_note') && !creditNote && invoice.creditedTtc === 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setCrediting(invoice)}>
                      <Undo2Icon aria-hidden />
                      {t('createCredit')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {data.invoices.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('invoicedTotal', { amount: money(data.invoicedTtc) })}
          </p>
        )}
      </CardContent>

      <AlertDialog open={issuing !== null} onOpenChange={(open) => !open && setIssuing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{issuing && t(`issue.${issuing}`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {issuing && t('issueDialog.description', { amount: money(amountOf(issuing)) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('issueDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={issue.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!issuing) return;
                issue.mutate(issuing, {
                  onSuccess: (state) => {
                    const created = state.invoices.at(-1);
                    toast.success(t('issueDialog.done', { number: created?.number ?? '' }));
                    setIssuing(null);
                  },
                  onError: (error) => {
                    toast.error(describeError(error));
                    setIssuing(null);
                  },
                });
              }}
            >
              {t('issueDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReasonDialog
        key={crediting?.id ?? 'none'}
        open={crediting !== null}
        title={t('creditDialog.title', { number: crediting?.number ?? '' })}
        description={t('creditDialog.description', {
          amount: money(crediting?.totalTtc ?? 0),
        })}
        label={t('creditDialog.reason')}
        confirmLabel={t('creditDialog.confirm')}
        destructive
        pending={credit.isPending}
        onCancel={() => setCrediting(null)}
        onConfirm={(reason) => {
          if (!crediting) return;
          credit.mutate(
            { id: crediting.id, reason },
            {
              onSuccess: (state) => {
                const created = state.invoices.at(-1);
                toast.success(t('creditDialog.done', { number: created?.number ?? '' }));
                setCrediting(null);
              },
              onError: (error) => toast.error(describeError(error)),
            },
          );
        }}
      />
    </Card>
  );
}
