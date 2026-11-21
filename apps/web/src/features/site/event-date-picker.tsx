'use client';

import { useQuery } from '@tanstack/react-query';
import { clientCalendarSchema } from '@traiteur/shared';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api/client';
import { formatLongDate, monthName, weekdayName } from '@/lib/format/date';
import { cn } from '@/lib/utils';

import { clientKeys } from './client-api';
import { dayStatus, monthBounds, monthGrid, shiftMonth } from './event-date';
import { usePublicSite } from './site-api';
import { whatsappUrl } from './whatsapp-button';

/** Une semaine de référence (lundi → dimanche) pour les noms des jours. */
const WEEK = [
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-07',
  '2026-11-08',
];

/**
 * Date de l'événement : calendrier du mois en jours civils. Les dates trop proches (délai
 * minimum du traiteur), fermées (jour de fermeture, date bloquée) ou complètes sont grisées et
 * non sélectionnables ; un lien WhatsApp propose de contacter le traiteur pour une date plus
 * proche. La valeur est la chaîne « AAAA-MM-JJ », envoyée telle quelle à l'API.
 */
export function EventDatePicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (day: string) => void;
  invalid?: boolean;
}) {
  const t = useTranslations('site.request.datePicker');
  const locale = useLocale();
  const site = usePublicSite();
  // Mois affiché : choisi par le client, sinon celui de la date choisie, sinon le mois de la
  // première date possible (connue après la première lecture, faite sur le mois courant)
  const [browsed, setBrowsed] = useState<string | null>(null);
  const [earliest, setEarliest] = useState<string | null>(null);
  const month =
    browsed ??
    (value ? value.slice(0, 7) : (earliest?.slice(0, 7) ?? new Date().toISOString().slice(0, 7)));
  const setMonth = setBrowsed;
  const bounds = monthBounds(month);
  const calendar = useQuery({
    queryKey: [...clientKeys.all, 'calendar', bounds.from],
    queryFn: async ({ signal }) => {
      const data = await apiRequest(`/client/calendar?from=${bounds.from}&to=${bounds.to}`, {
        schema: clientCalendarSchema,
        signal,
      });
      setEarliest(data.earliest);
      return data;
    },
    placeholderData: (previous) => previous,
  });

  const whatsapp = site.data?.whatsappPhone;
  const contactHref = whatsapp
    ? whatsappUrl(whatsapp, t('whatsappMessage'))
    : site.data
      ? `tel:${site.data.phone}`
      : undefined;
  const canGoBack = !earliest || month > earliest.slice(0, 7);

  return (
    <div className="flex flex-col gap-2" data-testid="event-date-picker">
      <div
        id={id}
        role="group"
        aria-invalid={invalid}
        aria-label={value ? formatLongDate(value, locale) : t('none')}
        className={cn(
          // Couleurs explicites : l'état « invalide » du champ ne colore que la bordure
          'w-full max-w-sm rounded-xl border bg-card p-3 text-card-foreground',
          invalid && 'border-destructive ring-2 ring-destructive/20',
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMonth(shiftMonth(month, -1))}
            disabled={!canGoBack}
            aria-label={t('previousMonth')}
            data-testid="date-previous-month"
          >
            <ChevronLeftIcon className="rtl:rotate-180" />
          </Button>
          <span className="font-bold capitalize" data-testid="date-month">
            {monthName(bounds.from, locale)} <span dir="ltr">{month.slice(0, 4)}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label={t('nextMonth')}
            data-testid="date-next-month"
          >
            <ChevronRightIcon className="rtl:rotate-180" />
          </Button>
        </div>
        <table className="w-full table-fixed border-collapse text-center text-sm">
          <thead>
            <tr>
              {WEEK.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className="pb-1 text-xs font-medium text-muted-foreground"
                >
                  {weekdayName(day, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthGrid(month).map((week, index) => (
              <tr key={index}>
                {week.map((day, column) =>
                  day === null ? (
                    <td key={column} />
                  ) : (
                    <td key={day} className="p-0.5">
                      <DayButton
                        day={day}
                        status={dayStatus(day, calendar.data)}
                        selected={day === value}
                        loading={!calendar.data}
                        onPick={onChange}
                      />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="size-3 rounded-sm bg-muted" aria-hidden />
            {t('legendUnavailable')}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-3 rounded-sm border border-amber-400 bg-amber-50" aria-hidden />
            {t('legendFull')}
          </span>
        </p>
      </div>
      {value && (
        <p className="text-sm font-medium text-foreground" data-testid="date-chosen">
          {formatLongDate(value, locale)}
        </p>
      )}
      <p className="text-sm text-muted-foreground" data-testid="date-too-soon-note">
        {earliest && t('earliest', { date: formatLongDate(earliest, locale) })}{' '}
        {contactHref ? (
          <a
            href={contactHref}
            target={whatsapp ? '_blank' : undefined}
            rel={whatsapp ? 'noopener noreferrer' : undefined}
            className="font-medium text-primary underline underline-offset-2"
            data-testid="date-contact-link"
          >
            {whatsapp ? t('contactWhatsapp') : t('contactPhone')}
          </a>
        ) : null}
      </p>
    </div>
  );
}

function DayButton({
  day,
  status,
  selected,
  loading,
  onPick,
}: {
  day: string;
  status: ReturnType<typeof dayStatus>;
  selected: boolean;
  loading: boolean;
  onPick: (day: string) => void;
}) {
  const t = useTranslations('site.request.datePicker');
  const locale = useLocale();
  const disabled = loading || status !== 'available';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(day)}
      aria-pressed={selected}
      aria-label={
        status === 'available'
          ? formatLongDate(day, locale)
          : `${formatLongDate(day, locale)} — ${t(`status.${status}`)}`
      }
      title={status === 'available' ? undefined : t(`status.${status}`)}
      data-day={day}
      data-status={status}
      className={cn(
        'flex h-9 w-full items-center justify-center rounded-md tabular-nums transition-colors',
        status === 'available' && 'text-card-foreground hover:bg-primary/10',
        (status === 'tooSoon' || status === 'closed') &&
          'cursor-not-allowed bg-muted text-muted-foreground/60 line-through',
        status === 'full' &&
          'cursor-not-allowed border border-amber-400 bg-amber-50 text-amber-900/60 line-through dark:bg-amber-950 dark:text-amber-200/60',
        selected && 'bg-primary font-bold text-primary-foreground hover:bg-primary',
        loading && 'opacity-50',
      )}
    >
      <span dir="ltr">{Number(day.slice(8))}</span>
    </button>
  );
}
