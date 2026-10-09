'use client';

import { type Order, type Quote, type QuoteLink, todayInTimeZone } from '@traiteur/shared';
import {
  CalendarClockIcon,
  CheckIcon,
  FileTextIcon,
  LinkIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  TriangleAlertIcon,
  Unlink2Icon,
} from 'lucide-react';
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
import { openDocument } from '@/features/payments/payments-api';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDateTime, formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';

import { ManualAcceptanceDialog, QuoteDraftDialog, QuoteLinkDialog } from './quote-dialogs';
import {
  useCreateQuote,
  useOrderQuotes,
  useRenewQuoteLink,
  useRevokeQuoteLink,
  useSendQuote,
} from './quotes-api';

const STATUS_VARIANTS: Record<
  Quote['status'],
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  DRAFT: 'outline',
  SENT: 'default',
  ACCEPTED: 'secondary',
  REJECTED: 'destructive',
  EXPIRED: 'outline',
  SUPERSEDED: 'outline',
};

/** La commande accepte encore un devis (pas clôturée ni annulée). */
const QUOTABLE = ['DRAFT', 'PENDING', 'QUOTED', 'CONFIRMED', 'IN_PREPARATION'];

type DialogState =
  | { kind: 'draft'; quote: Quote }
  | { kind: 'send'; quote: Quote }
  | { kind: 'link'; quote: Quote; link: QuoteLink }
  | { kind: 'manual'; quote: Quote }
  | null;

/** Devis de la commande : versions, envoi du lien, accord en ligne ou enregistré. */
export function QuotesCard({ order, timeZone }: { order: Order; timeZone: string }) {
  const t = useTranslations('quotes');
  const locale = useLocale();
  const can = usePermission();
  const describeError = useErrorMessage();
  const quotes = useOrderQuotes(order.id);
  const create = useCreateQuote(order.id);
  const send = useSendQuote(order.id);
  const renew = useRenewQuoteLink(order.id);
  const revoke = useRevokeQuoteLink(order.id);
  const [dialog, setDialog] = useState<DialogState>(null);
  const today = todayInTimeZone(timeZone);
  const manage = can('quotes.manage');

  if (quotes.isPending) return <Skeleton className="h-48 w-full" />;
  if (isApiError(quotes.error) && quotes.error.code === 'FEATURE_DISABLED') {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('notInPlan')}</p>
        </CardHeader>
      </Card>
    );
  }
  const list = quotes.data ?? [];
  const latest = list[0];
  const draft = latest?.status === 'DRAFT' ? latest : null;
  const current = list.find((quote) => quote.status !== 'DRAFT');
  const needsNewQuote =
    current?.status === 'SUPERSEDED' && current.supersededReason === 'ORDER_CHANGED';
  const pendingDate = list.find(
    (quote) => quote.status === 'ACCEPTED' && quote.availabilityPending,
  );
  const quotable = QUOTABLE.includes(order.status) && order.lines.length > 0;

  const fail = (error: unknown) => toast.error(describeError(error));
  const prepare = () =>
    create.mutate(
      {},
      {
        onSuccess: (quote) => {
          toast.success(
            t(draft ? 'prepared.updated' : 'prepared.created', { version: quote.version }),
          );
        },
        onError: fail,
      },
    );
  const showLink = (quote: Quote, link: QuoteLink) => setDialog({ kind: 'link', quote, link });

  return (
    <Card data-testid="quotes-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileTextIcon className="size-5 text-muted-foreground" aria-hidden />
          {t('title')}
        </CardTitle>
        {manage && quotable && (
          <Button size="sm" onClick={prepare} disabled={create.isPending}>
            {draft ? <RefreshCwIcon aria-hidden /> : <PlusIcon aria-hidden />}
            {draft
              ? t('actions.refresh')
              : list.length > 0
                ? t('actions.newVersion')
                : t('actions.prepare')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {needsNewQuote && !draft && (
          <p
            className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            data-testid="quote-needs-new"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('banners.orderChanged')}
          </p>
        )}
        {pendingDate && (
          <p
            className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            data-testid="quote-date-pending"
          >
            <CalendarClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('banners.datePending', { name: pendingDate.acceptance?.name ?? '' })}
          </p>
        )}
        {list.length === 0 ? (
          <p className="text-muted-foreground">{quotable ? t('empty') : t('emptyNoLines')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border" data-testid="quotes-list">
            {list.map((quote) => (
              <li
                key={quote.id}
                className={cn(
                  'flex flex-col gap-2 p-3',
                  ['SUPERSEDED', 'EXPIRED', 'REJECTED'].includes(quote.status) && 'opacity-70',
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium" dir="ltr">
                    {quote.reference} v{quote.version}
                  </span>
                  <Badge variant={STATUS_VARIANTS[quote.status]} data-testid="quote-status">
                    {t(`status.${quote.status}`)}
                  </Badge>
                  <span className="ms-auto font-semibold tabular-nums" dir="ltr">
                    {formatMoney(quote.totalTtc, locale)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {quote.sentAt
                    ? t('sentOn', { date: formatDateTime(quote.sentAt, timeZone) })
                    : t('notSent')}
                  {' · '}
                  {t('validUntil', { date: formatLocalDate(quote.validUntil) })}
                  {' · '}
                  {t(`locales.${quote.locale}`)}
                  {quote.status === 'SENT' && (
                    <>
                      {' · '}
                      {quote.linkActive
                        ? t('linkViews', { count: quote.linkViews })
                        : t('linkInactive')}
                    </>
                  )}
                </p>
                {quote.acceptance && (
                  <p className="text-sm">
                    <CheckIcon className="me-1 inline size-4 text-emerald-600" aria-hidden />
                    {quote.acceptance.mode === 'ONLINE'
                      ? t('acceptance.online', {
                          name: quote.acceptance.name,
                          date: formatDateTime(quote.acceptance.at, timeZone),
                        })
                      : t('acceptance.manual', {
                          name: quote.acceptance.name,
                          mode: t(`manual.modes.${quote.acceptance.mode}`),
                          date: formatDateTime(quote.acceptance.at, timeZone),
                          by: quote.acceptance.recordedBy ?? '—',
                        })}
                    {quote.acceptance.note && (
                      <span className="block text-muted-foreground" dir="auto">
                        {quote.acceptance.note}
                      </span>
                    )}
                  </p>
                )}
                {quote.status === 'REJECTED' && (
                  <p className="text-sm text-destructive">
                    {quote.rejectionReason
                      ? t('rejectedReason', { reason: quote.rejectionReason })
                      : t('rejected')}
                  </p>
                )}
                {quote.status === 'SUPERSEDED' && quote.supersededReason && (
                  <p className="text-sm text-muted-foreground">
                    {t(`superseded.${quote.supersededReason}`)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openDocument(`/quotes/${quote.id}/pdf`).catch(fail)}
                  >
                    <FileTextIcon aria-hidden />
                    {quote.status === 'DRAFT' ? t('actions.preview') : t('actions.pdf')}
                  </Button>
                  {manage && quote.status === 'DRAFT' && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDialog({ kind: 'draft', quote })}
                      >
                        <PencilIcon aria-hidden />
                        {t('actions.edit')}
                      </Button>
                      <Button size="sm" onClick={() => setDialog({ kind: 'send', quote })}>
                        <SendIcon aria-hidden />
                        {t('actions.send')}
                      </Button>
                    </>
                  )}
                  {manage && (quote.status === 'SENT' || quote.status === 'ACCEPTED') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={renew.isPending}
                      onClick={() =>
                        renew.mutate(quote.id, {
                          onSuccess: (link) => showLink(quote, link),
                          onError: fail,
                        })
                      }
                    >
                      <LinkIcon aria-hidden />
                      {t('actions.newLink')}
                    </Button>
                  )}
                  {manage && quote.status === 'SENT' && quote.linkActive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() =>
                        revoke.mutate(quote.id, {
                          onSuccess: () => toast.success(t('linkRevoked')),
                          onError: fail,
                        })
                      }
                    >
                      <Unlink2Icon aria-hidden />
                      {t('actions.revokeLink')}
                    </Button>
                  )}
                  {can('orders.write') &&
                    (quote.status === 'SENT' || quote.status === 'EXPIRED') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDialog({ kind: 'manual', quote })}
                      >
                        <CheckIcon aria-hidden />
                        {t('actions.recordAcceptance')}
                      </Button>
                    )}
                  {quote.acceptance?.hasAttachment && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        openDocument(`/quotes/${quote.id}/acceptance-attachment`).catch(fail)
                      }
                    >
                      <PaperclipIcon aria-hidden />
                      {t('actions.attachment')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {dialog?.kind === 'draft' && (
        <QuoteDraftDialog
          orderId={order.id}
          quote={dialog.quote}
          today={today}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'link' && (
        <QuoteLinkDialog
          quote={dialog.quote}
          link={dialog.link}
          client={{ firstName: order.client.firstName, phone: order.client.phone }}
          timeZone={timeZone}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'manual' && (
        <ManualAcceptanceDialog
          orderId={order.id}
          quote={dialog.quote}
          clientName={`${order.client.firstName} ${order.client.lastName}`.trim()}
          onClose={() => setDialog(null)}
        />
      )}
      <AlertDialog open={dialog?.kind === 'send'} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sendDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {order.status === 'PENDING'
                ? t('sendDialog.descriptionPending')
                : t('sendDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('sendDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={send.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (dialog?.kind !== 'send') return;
                send.mutate(dialog.quote.id, {
                  onSuccess: (result) => {
                    toast.success(t('sendDialog.done'));
                    showLink(result.quote, result.link);
                  },
                  onError: (error) => {
                    fail(error);
                    setDialog(null);
                  },
                });
              }}
            >
              <SendIcon aria-hidden />
              {t('sendDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
