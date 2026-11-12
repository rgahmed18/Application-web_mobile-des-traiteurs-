'use client';

import { DownloadIcon, FileTextIcon, ReceiptIcon, WalletIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { PublicQuoteView, type QuoteActions } from '@/app/devis/[token]/public-quote-view';
import { EmptyState } from '@/components/layout/list-states';
import { LoadError } from '@/components/layout/load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDate, formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

import {
  clientQuoteRespond,
  openClientDocument,
  useClientInvoices,
  useClientPayments,
  useClientQuote,
  useClientQuotes,
} from '../client-api';

function useMoney() {
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  return (cents: number) => formatMoney(cents, locale);
}

/** Devis reçus : à traiter d'abord, puis acceptés, refusés ou expirés. */
export function SpaceQuotes() {
  const t = useTranslations('site.space');
  const money = useMoney();
  const quotes = useClientQuotes();
  if (quotes.isPending) return <Skeleton className="h-48 w-full" />;
  if (!quotes.data) return <LoadError error={quotes.error} backHref="/espace" />;
  if (quotes.data.length === 0) {
    return (
      <EmptyState
        icon={FileTextIcon}
        title={t('quotes.empty')}
        description={t('quotes.emptyHint')}
      />
    );
  }
  return (
    <ul className="divide-y rounded-xl border" data-testid="client-quotes">
      {quotes.data.map((quote) => (
        <li key={quote.id}>
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
            {quote.status === 'SENT' && quote.validUntil && (
              <span className="text-sm text-muted-foreground">
                {t('validUntil', { date: formatLocalDate(quote.validUntil) })}
              </span>
            )}
            <span className="ms-auto font-medium" dir="ltr">
              {money(quote.totalTtc)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Un devis : même présentation que la page publique, actions par la session du client. */
export function SpaceQuote({ id }: { id: string }) {
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  const describeError = useErrorMessage();
  const quote = useClientQuote(id);
  const actions = useMemo<QuoteActions>(
    () => ({
      respond: clientQuoteRespond(id),
      pdf: {
        download: () =>
          openClientDocument(`/client/quotes/${id}/pdf`).catch((error: unknown) => {
            toast.error(describeError(error));
          }),
      },
      languageSwitch: false,
    }),
    [id, describeError],
  );
  if (quote.isPending) return <Skeleton className="h-96 w-full" />;
  if (!quote.data) return <LoadError error={quote.error} backHref="/espace/devis" />;
  return <PublicQuoteView actions={actions} initial={quote.data} locale={locale} embedded />;
}

/** Factures et reçus : téléchargement en PDF. */
export function SpaceInvoices() {
  const t = useTranslations('site.space');
  const money = useMoney();
  const describeError = useErrorMessage();
  const invoices = useClientInvoices();
  const payments = useClientPayments();
  if (invoices.isPending || payments.isPending) return <Skeleton className="h-48 w-full" />;
  if (!invoices.data || !payments.data) {
    return <LoadError error={invoices.error ?? payments.error} backHref="/espace" />;
  }
  const receipts = payments.data.filter((payment) => payment.receiptNumber);
  if (invoices.data.length === 0 && receipts.length === 0) {
    return (
      <EmptyState
        icon={ReceiptIcon}
        title={t('invoices.empty')}
        description={t('invoices.emptyHint')}
      />
    );
  }
  const download = (path: string) =>
    openClientDocument(path).catch((error: unknown) => toast.error(describeError(error)));
  return (
    <div className="flex flex-col gap-4" data-testid="client-documents">
      {invoices.data.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('invoices.invoices')}</h2>
          <ul className="divide-y rounded-xl border">
            {invoices.data.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="font-medium" dir="ltr">
                  {invoice.number}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(
                    `invoiceKinds.${invoice.type === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : invoice.kind}`,
                  )}{' '}
                  · {formatDate(invoice.issuedAt)}
                </span>
                <span className="ms-auto" dir="ltr">
                  {money(invoice.totalTtc)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void download(`/client/invoices/${invoice.id}/pdf`)}
                >
                  <DownloadIcon aria-hidden />
                  {t('download')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {receipts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('invoices.receipts')}</h2>
          <ul className="divide-y rounded-xl border">
            {receipts.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="font-medium" dir="ltr">
                  {payment.receiptNumber}
                </span>
                {payment.voided && <Badge variant="outline">{t('voided')}</Badge>}
                <span className="ms-auto" dir="ltr">
                  {money(payment.amount)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void download(`/client/payments/${payment.id}/receipt`)}
                >
                  <DownloadIcon aria-hidden />
                  {t('download')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Paiements enregistrés par le traiteur. */
export function SpacePayments() {
  const t = useTranslations('site.space');
  const money = useMoney();
  const payments = useClientPayments();
  if (payments.isPending) return <Skeleton className="h-48 w-full" />;
  if (!payments.data) return <LoadError error={payments.error} backHref="/espace" />;
  if (payments.data.length === 0) {
    return (
      <EmptyState
        icon={WalletIcon}
        title={t('payments.empty')}
        description={t('payments.emptyHint')}
      />
    );
  }
  return (
    <ul className="divide-y rounded-xl border" data-testid="client-payments">
      {payments.data.map((payment) => (
        <li key={payment.id} className="flex flex-wrap items-center gap-3 p-3">
          <span className="font-medium" dir="ltr">
            {payment.type === 'REFUND' ? '−' : ''}
            {money(payment.amount)}
          </span>
          <span className="text-sm text-muted-foreground">
            {t(`paymentTypes.${payment.type}`)} · {t(`paymentMethods.${payment.method}`)}
            {payment.paidAt ? ` · ${formatDate(payment.paidAt)}` : ''}
          </span>
          {payment.voided && <Badge variant="outline">{t('voided')}</Badge>}
          <span className="ms-auto text-sm text-muted-foreground" dir="ltr">
            {payment.orderReference}
          </span>
        </li>
      ))}
    </ul>
  );
}
