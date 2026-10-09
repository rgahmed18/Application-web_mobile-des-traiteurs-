'use client';

import { formatTaxRate, type PublicQuote, publicQuoteSchema } from '@traiteur/shared';
import {
  CalendarClockIcon,
  CalendarIcon,
  CheckCircle2Icon,
  DownloadIcon,
  MapPinIcon,
  PhoneIcon,
  UsersIcon,
  XCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { UiLocale } from '@/i18n/config';
import { publicEnv } from '@/lib/env/public';
import { formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

type Step = 'view' | 'accept' | 'reject';

/** Appel public (sans session) : réponse validée, code d'erreur stable sinon. */
async function respond(token: string, action: 'accept' | 'reject', body: object) {
  const response = await fetch(
    `${publicEnv.NEXT_PUBLIC_API_URL}/public/quotes/${encodeURIComponent(token)}/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      referrerPolicy: 'no-referrer',
    },
  );
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      json && typeof json === 'object' && 'code' in json && typeof json.code === 'string'
        ? json.code
        : `HTTP_${response.status}`;
    throw new Error(code);
  }
  return publicQuoteSchema.parse(json);
}

/** Devis vu par le client : détail, téléchargement du PDF, accord ou refus. */
export function PublicQuoteView({
  token,
  initial,
  locale,
}: {
  token: string;
  initial: PublicQuote;
  locale: UiLocale;
}) {
  const t = useTranslations('publicQuote');
  const tEvent = useTranslations('eventType');
  const [quote, setQuote] = useState(initial);
  const [step, setStep] = useState<Step>('view');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (cents: number) => formatMoney(cents, locale);
  const ttc = quote.priceMode === 'TTC';
  const pdfUrl = `${publicEnv.NEXT_PUBLIC_API_URL}/public/quotes/${encodeURIComponent(token)}/pdf`;

  const submit = async (action: 'accept' | 'reject') => {
    setPending(true);
    setError(null);
    try {
      const body =
        action === 'accept'
          ? { name: name.trim(), consent }
          : { reason: reason.trim() === '' ? null : reason.trim() };
      setQuote(await respond(token, action, body));
      setStep('view');
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      setError(
        code === 'QUOTE_EXPIRED'
          ? t('errors.expired')
          : code === 'QUOTE_NOT_OPEN'
            ? t('errors.closed')
            : code === 'VALIDATION_ERROR'
              ? t('errors.validation')
              : code === 'HTTP_429'
                ? t('errors.tooMany')
                : t('errors.generic'),
      );
    } finally {
      setPending(false);
    }
  };

  const otherLocale = locale === 'ar' ? 'fr' : 'ar';
  const eventTime = quote.event.endTime
    ? t('eventTime', {
        start: quote.event.startTime,
        end: quote.event.endTime,
        nextDay: quote.event.endsNextDay ? 'yes' : 'no',
      })
    : quote.event.startTime;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{t('from')}</p>
          <h1 className="text-2xl font-semibold" dir="auto">
            {quote.traiteur.name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <PhoneIcon className="size-4" aria-hidden />
            <a
              href={`tel:${quote.traiteur.phone}`}
              dir="ltr"
              className="underline-offset-2 hover:underline"
            >
              {quote.traiteur.phone}
            </a>
            <span dir="ltr">{quote.traiteur.email}</span>
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`?lang=${otherLocale}`} replace>
            {t('switchLanguage')}
          </Link>
        </Button>
      </header>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xl">
            {t('title')}{' '}
            <span dir="ltr" className="text-muted-foreground">
              {quote.reference} v{quote.version}
            </span>
          </CardTitle>
          <Badge
            variant={quote.status === 'SENT' ? 'default' : 'secondary'}
            data-testid="public-quote-status"
          >
            {t(`status.${quote.status}`)}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-lg">{t('greeting', { name: quote.clientName })}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            <li className="flex items-center gap-2">
              <CalendarIcon className="size-5 text-muted-foreground" aria-hidden />
              <span>
                {tEvent(quote.event.type)} —{' '}
                <span dir="ltr">{formatLocalDate(quote.event.date)}</span>{' '}
                <span dir="ltr">{eventTime}</span>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <UsersIcon className="size-5 text-muted-foreground" aria-hidden />
              {t('guests', { count: quote.event.guestCount })}
            </li>
            <li className="flex items-center gap-2 sm:col-span-2">
              <MapPinIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span dir="auto">{quote.event.venue}</span>
            </li>
          </ul>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="bg-muted/60 text-start">
                <tr>
                  <th className="p-2 text-start">{t('table.label')}</th>
                  <th className="p-2 text-center">{t('table.quantity')}</th>
                  <th className="p-2 text-end">{ttc ? t('table.unitTtc') : t('table.unitHt')}</th>
                  <th className="p-2 text-end">{ttc ? t('table.totalTtc') : t('table.totalHt')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {quote.lines.map((line, index) => (
                  <tr key={index}>
                    <td className="p-2" dir="auto">
                      {line.label}
                      {line.discount > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {t('table.discount', { amount: money(line.discount * line.quantity) })}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center tabular-nums">{line.quantity}</td>
                    <td className="p-2 text-end tabular-nums" dir="ltr">
                      {money(line.unitPrice)}
                    </td>
                    <td className="p-2 text-end tabular-nums" dir="ltr">
                      {money(line.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="ms-auto flex w-full max-w-xs flex-col gap-1">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t('totals.ht')}</dt>
              <dd className="tabular-nums" dir="ltr">
                {money(quote.totalHt)}
              </dd>
            </div>
            {quote.taxBreakdown.map((entry) => (
              <div key={entry.taxRateBps} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t('totals.tax', { rate: formatTaxRate(entry.taxRateBps) })}
                </dt>
                <dd className="tabular-nums" dir="ltr">
                  {money(entry.taxAmount)}
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t pt-2 text-lg font-semibold">
              <dt>{t('totals.ttc')}</dt>
              <dd className="tabular-nums" dir="ltr" data-testid="public-quote-total">
                {money(quote.totalTtc)}
              </dd>
            </div>
          </dl>
          <p className="rounded-lg bg-muted/50 p-3 text-sm">
            {t('amountInWords', { words: quote.amountInWords })}
          </p>

          <div className="flex flex-col gap-1 text-sm">
            {quote.depositAmount > 0 && (
              <p>{t('deposit', { amount: money(quote.depositAmount) })}</p>
            )}
            {quote.balanceDueDate && (
              <p>{t('balance', { date: formatLocalDate(quote.balanceDueDate) })}</p>
            )}
            <p className="text-muted-foreground">
              {t('validUntil', { date: formatLocalDate(quote.validUntil) })}
            </p>
          </div>
          {quote.terms && (
            <div className="text-sm">
              <p className="font-medium">{t('terms')}</p>
              <p className="whitespace-pre-line text-muted-foreground" dir="auto">
                {quote.terms}
              </p>
            </div>
          )}

          <Button asChild variant="outline" className="self-start">
            <a href={pdfUrl} target="_blank" rel="noreferrer noopener">
              <DownloadIcon aria-hidden />
              {t('downloadPdf')}
            </a>
          </Button>
        </CardContent>
      </Card>

      <Outcome quote={quote} />

      {quote.status === 'SENT' && step === 'view' && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="lg" className="sm:flex-1" onClick={() => setStep('accept')}>
            <CheckCircle2Icon aria-hidden />
            {t('accept')}
          </Button>
          <Button size="lg" variant="outline" onClick={() => setStep('reject')}>
            {t('reject')}
          </Button>
        </div>
      )}

      {quote.status === 'SENT' && step === 'accept' && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="accept-name">{t('acceptForm.name')}</Label>
              <Input
                id="accept-name"
                value={name}
                autoComplete="name"
                dir="auto"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="accept-consent"
                checked={consent}
                onCheckedChange={(value) => setConsent(value === true)}
              />
              <Label htmlFor="accept-consent" className="leading-snug font-normal">
                {t('acceptForm.consent', { amount: money(quote.totalTtc) })}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">{t('acceptForm.trace')}</p>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="lg"
                className="sm:flex-1"
                disabled={pending || name.trim().length < 2 || !consent}
                onClick={() => void submit('accept')}
              >
                {t('acceptForm.submit')}
              </Button>
              <Button size="lg" variant="ghost" onClick={() => setStep('view')}>
                {t('cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {quote.status === 'SENT' && step === 'reject' && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="reject-reason">{t('rejectForm.reason')}</Label>
              <Textarea
                id="reject-reason"
                rows={3}
                value={reason}
                dir="auto"
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="lg"
                variant="destructive"
                className="sm:flex-1"
                disabled={pending}
                onClick={() => void submit('reject')}
              >
                {t('rejectForm.submit')}
              </Button>
              <Button size="lg" variant="ghost" onClick={() => setStep('view')}>
                {t('cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

/** Résultat affiché au client une fois qu'il a répondu (ou si le devis n'est plus en cours). */
function Outcome({ quote }: { quote: PublicQuote }) {
  const t = useTranslations('publicQuote.outcome');
  if (quote.status === 'ACCEPTED') {
    const pending = quote.availabilityPending;
    return (
      <p
        className="flex items-start gap-3 rounded-lg bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        role="status"
        data-testid="public-quote-outcome"
      >
        {pending ? (
          <CalendarClockIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
        ) : (
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
        )}
        <span>
          {/* Date bloquée ou complète : jamais « confirmé » tant que le traiteur n'a pas tranché */}
          {pending ? t('acceptedPending') : t('accepted')}
          {quote.acceptance && (
            <span className="block text-sm opacity-80">
              {t('acceptedBy', { name: quote.acceptance.name })}
            </span>
          )}
        </span>
      </p>
    );
  }
  if (quote.status === 'SENT') return null;
  return (
    <p
      className="flex items-start gap-3 rounded-lg bg-muted p-4"
      role="status"
      data-testid="public-quote-outcome"
    >
      <XCircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      {t(quote.status)}
    </p>
  );
}
