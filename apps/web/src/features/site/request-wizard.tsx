'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AvailabilityHint,
  clientAvailabilitySchema,
  type ClientRequestInput,
  clientRequestCreatedSchema,
  clientRequestSchema,
  DEFAULT_REQUEST_RULES,
  guestsRuleError,
  localDateSchema,
  localTimeSchema,
  phoneSchema,
} from '@traiteur/shared';
import { CheckCircle2Icon, CircleHelpIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, type FieldPath } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLocalized } from '@/features/catalog/use-localized';
import { useDebouncedValue } from '@/features/catalog/use-debounced-value';
import { apiRequest } from '@/lib/api/client';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatLongDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { useZodForm } from '@/lib/forms/use-zod-form';

import {
  alternativeGroups,
  cartEstimate,
  formatEstimate,
  formatEstimateAmount,
} from './cart-estimate';
import { cartStore, perGuest } from './cart-store';
import { type CartLine, CartReview, useCartLines, useCartRanges } from './cart-review';
import { clientKeys } from './client-api';
import { EventDatePicker } from './event-date-picker';
import { parseGuests } from './guests';
import { commonEventType, outsideMenuLimits, typeMismatch } from './request-checks';
import { usePublicCatalog, usePublicCatalogOptions, usePublicSite } from './site-api';

const STEPS = ['event', 'choices', 'venue', 'summary'] as const;
type Step = (typeof STEPS)[number];

const optional = z.string().trim();
const formSchema = z.object({
  eventType: z.string().min(1),
  eventDate: localDateSchema,
  startTime: localTimeSchema,
  endTime: z.union([z.literal(''), localTimeSchema]),
  endsNextDay: z.boolean(),
  // Nombre d'invités : entier, le même que dans le comparateur et « Ma demande » ; les règles
  // du traiteur (minimum, maximum) sont vérifiées au passage à l'étape suivante
  guestCount: z.string().refine((value) => parseGuests(value).value !== null, {
    params: { i18n: 'invalidNumber' },
  }),
  venueName: optional.max(150),
  venueAddress: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(100),
  saveAddressAs: optional.max(60),
  onSiteContactName: optional.max(120),
  onSiteContactPhone: z.union([z.literal(''), phoneSchema]),
  notes: optional.max(2000),
});
type FormValues = z.input<typeof formSchema>;

/** Champs vérifiés avant de passer à l'étape suivante. */
const STEP_FIELDS: Record<Step, FieldPath<FormValues>[]> = {
  event: ['eventType', 'eventDate', 'startTime', 'endTime', 'guestCount'],
  choices: [],
  venue: ['venueAddress', 'city', 'venueName', 'onSiteContactPhone'],
  summary: [],
};

/** Prix estimé d'une ligne : par invité, au forfait, ou à la quantité. */
function estimate(line: CartLine, guests: number): number {
  if (line.entry.unit === 'perPerson') return line.entry.priceTtc * guests;
  if (line.entry.unit === 'flat') return line.entry.priceTtc;
  return line.entry.priceTtc * line.quantity;
}

function AvailabilityLabel({ hint }: { hint: AvailabilityHint }) {
  const t = useTranslations('site.request.availability');
  return hint === 'AVAILABLE' ? (
    <span className="inline-flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
      <CheckCircle2Icon className="size-4" aria-hidden />
      {t('AVAILABLE')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
      <CircleHelpIcon className="size-4" aria-hidden />
      {t('ON_REQUEST')}
    </span>
  );
}

/**
 * Demande en ligne, en 4 étapes : événement (date « disponible » ou « sur demande »), choix du
 * catalogue (matériel « disponible » ou « sur demande »), lieu, récapitulatif avec estimation
 * TTC indicative. À l'envoi : commande « En attente » chez le traiteur, « ma demande » vidée.
 */
export function RequestWizard() {
  const t = useTranslations('site.request');
  const tGuests = useTranslations('site.guests');
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  const localized = useLocalized();
  const describeError = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = usePublicCatalogOptions();
  const site = usePublicSite();
  const catalog = usePublicCatalog();
  const rules = site.data?.requestRules ?? DEFAULT_REQUEST_RULES;
  const { lines } = useCartLines();
  const ranges = useCartRanges();
  const [step, setStep] = useState<Step>('event');
  const form = useZodForm(formSchema, {
    eventType: '',
    eventDate: '',
    startTime: '19:00',
    endTime: '',
    endsNextDay: false,
    // Nombre d'invités choisi dans le comparateur des gammes, s'il y en a un
    guestCount: String(cartStore.guests() ?? ''),
    venueName: '',
    venueAddress: '',
    city: '',
    saveAddressAs: '',
    onSiteContactName: '',
    onSiteContactPhone: '',
    notes: '',
  });
  const values = form.watch();
  const guests = Number(values.guestCount) || 0;
  const menuLines = lines.filter((line) => line.entry.kind === 'menu');
  // Type d'événement prérempli si toutes les formules sont prévues pour le même
  const preset = commonEventType(menuLines.map((line) => line.entry));
  useEffect(() => {
    if (preset && form.getValues('eventType') === '') {
      form.setValue('eventType', preset, { shouldValidate: false });
    }
  }, [form, preset]);
  // Formule prévue pour un autre type d'événement : avertissement, jamais de blocage
  const mismatch = values.eventType
    ? typeMismatch(
        menuLines.map((line) => line.entry),
        values.eventType,
      )
    : null;
  const [mismatchAccepted, setMismatchAccepted] = useState<string | null>(null);
  /** « un mariage », « une aqiqa »… ; type propre au traiteur : « l'événement « Gala » ». */
  const eventPhrase = (codes: string[]) =>
    codes
      .map((code) => {
        const key = `eventFor.${code}` as 'eventFor.WEDDING';
        if (t.has(key)) return t(key);
        const item = options.data?.eventTypes.find((type) => type.code === code);
        return t('eventForOther', { name: item ? localized(item.name) : code });
      })
      .join(t('eventForJoin'));
  const limits =
    guests > 0
      ? outsideMenuLimits(
          menuLines.map((line) => line.entry),
          guests,
        )
      : [];

  // Disponibilité indicative de la date et du matériel choisi (sans chiffres)
  const schedule = useDebouncedValue(
    JSON.stringify({
      eventDate: values.eventDate,
      startTime: values.startTime,
      endTime: values.endTime || null,
      endsNextDay: values.endsNextDay,
      equipment: lines
        .filter((line) => line.entry.kind === 'equipment')
        .map((line) => ({ id: line.entry.id, quantity: line.quantity })),
    }),
  );
  const availability = useQuery({
    queryKey: [...clientKeys.all, 'availability', schedule],
    queryFn: ({ signal }) =>
      apiRequest('/client/availability', {
        method: 'POST',
        body: JSON.parse(schedule) as unknown,
        schema: clientAvailabilitySchema,
        signal,
      }),
    enabled:
      localDateSchema.safeParse(values.eventDate).success &&
      localTimeSchema.safeParse(values.startTime).success,
  });
  const equipmentHint = (id: string) =>
    availability.data?.equipment.find((item) => item.id === id)?.status;

  const send = useMutation({
    mutationFn: (input: ClientRequestInput) =>
      apiRequest('/client/requests', {
        method: 'POST',
        body: input,
        schema: clientRequestCreatedSchema,
      }),
  });

  /** Règles du traiteur : nombre d'invités (minimum, maximum). */
  const checkGuests = (): boolean => {
    const count = parseGuests(form.getValues('guestCount')).value;
    if (count === null) return true;
    const error = guestsRuleError(count, rules);
    if (!error) return true;
    form.setError('guestCount', {
      type: 'rules',
      message:
        error === 'belowMinimum'
          ? t('guestsBelowMinimum', { min: rules.minGuests })
          : t('guestsAboveMaximum', { max: rules.maxGuests }),
    });
    return false;
  };

  const goNext = async () => {
    if (!(await form.trigger(STEP_FIELDS[step]))) return;
    if (step === 'event' && !checkGuests()) return;
    if (step === 'choices' && lines.length === 0 && ranges.length === 0)
      return void toast.error(t('emptyChoices'));
    setStep(STEPS[STEPS.indexOf(step) + 1] ?? 'summary');
  };

  const onSubmit = form.handleSubmit(async (data) => {
    if (!checkGuests()) return void setStep('event');
    const parsed = clientRequestSchema.safeParse({
      eventType: data.eventType,
      eventDate: data.eventDate,
      startTime: data.startTime,
      endTime: data.endTime || null,
      endsNextDay: data.endTime ? data.endsNextDay : false,
      guestCount: Number(data.guestCount),
      venueName: data.venueName || null,
      venueAddress: data.venueAddress,
      city: data.city,
      saveAddressAs: data.saveAddressAs || null,
      onSiteContactName: data.onSiteContactName || null,
      onSiteContactPhone: data.onSiteContactPhone || null,
      notes: data.notes || null,
      items: lines.map((line) => ({
        kind: line.entry.kind,
        id: line.entry.id,
        quantity: line.quantity,
      })),
      ranges: ranges.map((range) => range.code),
    });
    if (!parsed.success) return void toast.error(t('invalid'));
    try {
      const created = await send.mutateAsync(parsed.data);
      cartStore.clear();
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      toast.success(t('sent', { reference: created.reference }));
      router.push(`/espace/demandes/${created.id}`);
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  // Estimation : formules d'un même événement en alternative (fourchette), comme « Ma demande »
  const total = cartEstimate(
    lines,
    guests || null,
    alternativeGroups(
      (catalog.data?.menus ?? []).filter((menu) =>
        menuLines.some((line) => line.entry.id === menu.id),
      ),
    ),
  );
  const estimateText =
    total === null
      ? '—'
      : total.min === total.max
        ? formatMoney(total.min, locale)
        : t('estimateBetween', {
            min: formatEstimateAmount(total.min, locale, formatMoney),
            max: formatEstimate(total.max, locale, formatMoney),
          });
  const eventTypeName = options.data?.eventTypes.find((item) => item.code === values.eventType);

  return (
    <form
      onSubmit={(event) => {
        // Entrée dans un champ avant le récapitulatif : étape suivante, jamais l'envoi
        if (step !== 'summary') {
          event.preventDefault();
          void goNext();
          return;
        }
        void onSubmit(event);
      }}
      noValidate
      className="flex flex-col gap-5"
      data-testid="request-wizard"
    >
      <ol className="flex flex-wrap gap-2 text-sm" aria-label={t('stepsLabel')}>
        {STEPS.map((item, index) => (
          <li
            key={item}
            aria-current={item === step ? 'step' : undefined}
            className={
              item === step
                ? 'rounded-full bg-primary px-3 py-1 text-primary-foreground'
                : 'rounded-full bg-muted px-3 py-1 text-muted-foreground'
            }
          >
            {index + 1}. {t(`steps.${item}`)}
          </li>
        ))}
      </ol>

      {step === 'event' && (
        <section className="flex flex-col gap-4" data-testid="request-step-event">
          <FormField
            control={form.control}
            name="eventType"
            label={t('fields.eventType')}
            render={(field, { invalid }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={field.id} aria-invalid={invalid} className="w-full">
                  <SelectValue placeholder={t('fields.chooseEventType')} />
                </SelectTrigger>
                <SelectContent>
                  {options.data?.eventTypes.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {localized(item.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {mismatch && mismatchAccepted !== `${values.eventType}:${mismatch.menu.id}` && (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              data-testid="event-type-mismatch"
            >
              <p className="flex items-start gap-2">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {t('typeMismatch', {
                    menu: localized(mismatch.menu.name),
                    event: eventPhrase(mismatch.expected),
                  })}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMismatchAccepted(`${values.eventType}:${mismatch.menu.id}`)}
                  data-testid="mismatch-continue"
                >
                  {t('typeMismatchContinue')}
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/catalogue/comparer?type=${encodeURIComponent(values.eventType)}`}
                    data-testid="mismatch-change"
                  >
                    {t('typeMismatchChange')}
                  </Link>
                </Button>
              </div>
            </div>
          )}
          <FormField
            control={form.control}
            name="eventDate"
            label={t('fields.date')}
            description={
              availability.data ? <AvailabilityLabel hint={availability.data.date} /> : undefined
            }
            render={(field, { invalid }) => (
              <EventDatePicker
                id={field.id}
                value={field.value}
                onChange={(day) => {
                  field.onChange(day);
                  form.clearErrors('eventDate');
                }}
                invalid={invalid}
              />
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="startTime"
              label={t('fields.startTime')}
              render={(field, { invalid }) => (
                <Input {...field} type="time" dir="ltr" aria-invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="endTime"
              label={t('fields.endTime')}
              render={(field, { invalid }) => (
                <Input {...field} type="time" dir="ltr" aria-invalid={invalid} />
              )}
            />
          </div>
          {values.endTime !== '' && (
            <Controller
              control={form.control}
              name="endsNextDay"
              render={({ field }) => (
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                  {t('fields.endsNextDay')}
                </label>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="guestCount"
            label={t('fields.guests')}
            description={t('guestsRules', { min: rules.minGuests, max: rules.maxGuests })}
            render={(field, { invalid }) => (
              <Input
                {...field}
                onChange={(event) => {
                  field.onChange(event);
                  form.clearErrors('guestCount');
                  // Partagé avec le comparateur et « Ma demande » (saisie valide ou vide)
                  const parsed = parseGuests(event.target.value);
                  if (!parsed.error) cartStore.setGuests(parsed.value);
                }}
                inputMode="numeric"
                placeholder={tGuests('placeholder')}
                dir="ltr"
                className="max-w-40"
                aria-invalid={invalid}
              />
            )}
          />
          {limits.length > 0 && (
            <ul
              className="flex flex-col gap-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              data-testid="menu-limits-warning"
            >
              {limits.map((entry) => (
                <li key={entry.id}>
                  {entry.maxGuests === null
                    ? t('menuMinWarning', {
                        menu: localized(entry.name),
                        min: entry.minGuests ?? 1,
                      })
                    : t('menuLimitsWarning', {
                        menu: localized(entry.name),
                        min: entry.minGuests ?? 1,
                        max: entry.maxGuests,
                      })}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {step === 'choices' && (
        <section className="flex flex-col gap-3" data-testid="request-step-choices">
          <CartReview guestsField={false} />
          {lines.some((line) => line.entry.kind === 'equipment') && (
            <ul className="flex flex-col gap-1" data-testid="equipment-availability">
              {lines
                .filter((line) => line.entry.kind === 'equipment')
                .map((line) => {
                  const hint = equipmentHint(line.entry.id);
                  return (
                    <li key={line.entry.id} className="flex flex-wrap items-center gap-2">
                      <span dir="auto">{localized(line.entry.name)}</span>
                      {hint && <AvailabilityLabel hint={hint} />}
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      )}

      {step === 'venue' && (
        <section className="flex flex-col gap-4" data-testid="request-step-venue">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="venueName"
              label={t('fields.venueName')}
              render={(field, { invalid }) => (
                <Input {...field} dir="auto" aria-invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="city"
              label={t('fields.city')}
              render={(field, { invalid }) => (
                <Input {...field} dir="auto" aria-invalid={invalid} />
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="venueAddress"
            label={t('fields.address')}
            render={(field, { invalid }) => (
              <Textarea {...field} rows={2} dir="auto" aria-invalid={invalid} />
            )}
          />
          <FormField
            control={form.control}
            name="saveAddressAs"
            label={t('fields.saveAddressAs')}
            description={t('fields.saveAddressHint')}
            render={(field, { invalid }) => (
              <Input {...field} dir="auto" className="max-w-64" aria-invalid={invalid} />
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="onSiteContactName"
              label={t('fields.contactName')}
              render={(field, { invalid }) => (
                <Input {...field} dir="auto" aria-invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="onSiteContactPhone"
              label={t('fields.contactPhone')}
              render={(field, { invalid }) => (
                <Input {...field} type="tel" dir="ltr" aria-invalid={invalid} />
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="notes"
            label={t('fields.notes')}
            render={(field, { invalid }) => (
              <Textarea {...field} rows={3} dir="auto" aria-invalid={invalid} />
            )}
          />
        </section>
      )}

      {step === 'summary' && (
        <section className="flex flex-col gap-4" data-testid="request-step-summary">
          <dl className="grid gap-2 rounded-xl border p-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">{t('fields.eventType')}</dt>
              <dd>{eventTypeName ? localized(eventTypeName.name) : values.eventType}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t('fields.date')}</dt>
              <dd data-testid="summary-date">
                {values.eventDate ? formatLongDate(values.eventDate, locale) : ''} ·{' '}
                <span dir="ltr">
                  {values.startTime}
                  {values.endTime ? ` – ${values.endTime}` : ''}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t('fields.guests')}</dt>
              <dd>{guests}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t('fields.address')}</dt>
              <dd dir="auto">
                {[values.venueName, values.venueAddress, values.city].filter(Boolean).join(', ')}
              </dd>
            </div>
          </dl>
          <ul className="flex flex-col divide-y rounded-xl border">
            {lines.map((line) => (
              <li
                key={`${line.entry.kind}-${line.entry.id}`}
                className="flex justify-between gap-3 p-3"
              >
                <span dir="auto">
                  {localized(line.entry.name)}
                  {!perGuest(line.entry.kind) && line.entry.unit !== 'flat'
                    ? ` × ${line.quantity}`
                    : ''}
                </span>
                <span dir="ltr">{formatMoney(estimate(line, guests), locale)}</span>
              </li>
            ))}
            <li
              className="flex justify-between gap-3 p-3 font-semibold"
              data-testid="request-estimate"
            >
              <span>{t('estimate')}</span>
              <span dir="auto">{estimateText}</span>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">{t('estimateHint')}</p>
        </section>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={step === 'event'}
          onClick={() => setStep(STEPS[STEPS.indexOf(step) - 1] ?? 'event')}
        >
          {t('previous')}
        </Button>
        {step === 'summary' ? (
          <Button key="send" type="submit" size="lg" disabled={form.formState.isSubmitting}>
            {t('send')}
          </Button>
        ) : (
          <Button key="next" type="button" size="lg" onClick={() => void goNext()}>
            {t('next')}
          </Button>
        )}
      </div>
    </form>
  );
}
