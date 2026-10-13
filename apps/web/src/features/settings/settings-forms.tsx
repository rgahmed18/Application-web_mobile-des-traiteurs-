'use client';

import {
  type AvailabilitySettings,
  availabilitySettingsSchema,
  type CompanySettings,
  companySettingsSchema,
  ISO_WEEKDAYS,
  type PricingSettings,
} from '@traiteur/shared';
import { CheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { PhoneInput } from '@/components/forms/phone-input';
import { UnsavedChangesGuard } from '@/components/forms/unsaved-changes-guard';
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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { FormSection } from '@/features/catalog/components/form-layout';
import { toInteger } from '@/features/catalog/forms/form-values';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';
import { cn } from '@/lib/utils';

import {
  useAvailabilitySettings,
  useCompanySettings,
  usePricingSettings,
  useSaveAvailabilitySettings,
  useSaveCompanySettings,
  useSavePricingSettings,
} from './settings-api';

/** Lecture d'un réglage : squelette, erreur ou formulaire. */
function Loaded<T>({
  query,
  children,
}: {
  query: { isPending: boolean; data: T | undefined; error: unknown };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.data === undefined) return <LoadError error={query.error} backHref="/admin" />;
  return <>{children(query.data)}</>;
}

/** Barre d'enregistrement commune aux onglets. */
function SaveBar({
  dirty,
  submitting,
  onReset,
}: {
  dirty: boolean;
  submitting: boolean;
  onReset: () => void;
}) {
  const tc = useTranslations('common');
  return (
    <div className="flex justify-end gap-3">
      <Button type="button" variant="outline" disabled={!dirty} onClick={onReset}>
        {tc('cancel')}
      </Button>
      <Button type="submit" disabled={submitting}>
        {submitting ? tc('saving') : tc('save')}
      </Button>
    </div>
  );
}

// ─────────────────────────── Entreprise : coordonnées ───────────────────────────

const companyFormSchema = z
  .object({ name: z.string(), email: z.string(), phone: z.string(), city: z.string() })
  .transform((values): z.input<typeof companySettingsSchema> => ({
    ...values,
    city: values.city.trim() === '' ? null : values.city,
  }))
  .pipe(companySettingsSchema);

const companyValues = (settings: CompanySettings) => ({
  name: settings.name,
  email: settings.email,
  phone: settings.phone,
  city: settings.city ?? '',
});

export function CompanyTab() {
  const query = useCompanySettings();
  return <Loaded query={query}>{(settings) => <CompanyForm settings={settings} />}</Loaded>;
}

function CompanyForm({ settings }: { settings: CompanySettings }) {
  const t = useTranslations('settings.company');
  const describeError = useErrorMessage();
  const save = useSaveCompanySettings();
  const form = useZodForm(companyFormSchema, companyValues(settings));
  const onSubmit = form.handleSubmit(async (input) => {
    try {
      form.reset(companyValues(await save.mutateAsync(input)));
      toast.success(t('saved'));
    } catch (error) {
      toast.error(describeError(error));
    }
  });
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      data-testid="company-settings"
    >
      <UnsavedChangesGuard when={form.formState.isDirty} />
      <FormSection title={t('title')} description={t('hint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            label={t('name')}
            render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
          />
          <FormField
            control={form.control}
            name="city"
            label={t('city')}
            render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
          />
          <FormField
            control={form.control}
            name="email"
            label={t('email')}
            render={(field, { invalid }) => (
              <Input {...field} type="email" dir="ltr" aria-invalid={invalid} />
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            label={t('phone')}
            render={(field, { invalid }) => <PhoneInput {...field} aria-invalid={invalid} />}
          />
        </div>
        <SaveBar
          dirty={form.formState.isDirty}
          submitting={form.formState.isSubmitting}
          onReset={() => form.reset(companyValues(settings))}
        />
      </FormSection>
    </form>
  );
}

// ─────────────────────────── Disponibilités ───────────────────────────

const availabilityFormSchema = z
  .object({
    limited: z.boolean(),
    maxEventsPerDay: z.string(),
    closedWeekdays: z.array(z.number()),
    redact: z.boolean(),
    missionRedactionDays: z.string(),
  })
  .transform((values): z.input<typeof availabilitySettingsSchema> => ({
    maxEventsPerDay: values.limited ? toInteger(values.maxEventsPerDay) : null,
    closedWeekdays: values.closedWeekdays,
    missionRedactionDays: values.redact ? toInteger(values.missionRedactionDays) : null,
  }))
  .pipe(availabilitySettingsSchema);

const availabilityValues = (settings: AvailabilitySettings) => ({
  limited: settings.maxEventsPerDay !== null,
  maxEventsPerDay: String(settings.maxEventsPerDay ?? 2),
  closedWeekdays: settings.closedWeekdays,
  redact: settings.missionRedactionDays !== null,
  missionRedactionDays: String(settings.missionRedactionDays ?? 7),
});

export function AvailabilityTab() {
  const query = useAvailabilitySettings();
  return <Loaded query={query}>{(settings) => <AvailabilityForm settings={settings} />}</Loaded>;
}

function SwitchRow({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </label>
    </div>
  );
}

function AvailabilityForm({ settings }: { settings: AvailabilitySettings }) {
  const t = useTranslations('settings.availability');
  const tw = useTranslations('settings.weekdays');
  const describeError = useErrorMessage();
  const save = useSaveAvailabilitySettings();
  const form = useZodForm(availabilityFormSchema, availabilityValues(settings));
  const limited = form.watch('limited');
  const redact = form.watch('redact');
  const closed = form.watch('closedWeekdays');
  const onSubmit = form.handleSubmit(async (input) => {
    try {
      form.reset(availabilityValues(await save.mutateAsync(input)));
      toast.success(t('saved'));
    } catch (error) {
      toast.error(describeError(error));
    }
  });
  const toggleDay = (day: number) => {
    const next = closed.includes(day) ? closed.filter((item) => item !== day) : [...closed, day];
    form.setValue('closedWeekdays', next, { shouldDirty: true });
  };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      data-testid="availability-settings"
    >
      <UnsavedChangesGuard when={form.formState.isDirty} />
      <FormSection title={t('capacityTitle')} description={t('capacityHint')}>
        <SwitchRow
          id="settings-limited"
          checked={limited}
          onChange={(checked) => form.setValue('limited', checked, { shouldDirty: true })}
          label={t('limited')}
          hint={t('limitedHint')}
        />
        {limited && (
          <FormField
            control={form.control}
            name="maxEventsPerDay"
            label={t('maxEventsPerDay')}
            render={(field, { invalid }) => (
              <Input
                {...field}
                inputMode="numeric"
                dir="ltr"
                className="max-w-32"
                aria-invalid={invalid}
              />
            )}
          />
        )}
      </FormSection>

      <FormSection title={t('closedTitle')} description={t('closedHint')}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('closedTitle')}>
          {ISO_WEEKDAYS.map((day) => {
            const isClosed = closed.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={isClosed}
                disabled={!isClosed && closed.length >= 6}
                onClick={() => toggleDay(day)}
                className={cn(
                  'flex min-w-24 items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50',
                  isClosed
                    ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                    : 'hover:bg-muted/50',
                )}
              >
                {isClosed && <CheckIcon className="size-4" aria-hidden />}
                {tw(String(day) as '1')}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          {closed.length === 0
            ? t('openEveryDay')
            : t('closedOn', {
                days: [...closed]
                  .sort((a, b) => a - b)
                  .map((day) => tw(String(day) as '1'))
                  .join(', '),
              })}
        </p>
      </FormSection>

      <FormSection title={t('missionsTitle')} description={t('missionsHint')}>
        <SwitchRow
          id="settings-redact"
          checked={redact}
          onChange={(checked) => form.setValue('redact', checked, { shouldDirty: true })}
          label={t('redact')}
          hint={t('redactHint')}
        />
        {redact && (
          <FormField
            control={form.control}
            name="missionRedactionDays"
            label={t('redactionDays')}
            render={(field, { invalid }) => (
              <Input
                {...field}
                inputMode="numeric"
                dir="ltr"
                className="max-w-32"
                aria-invalid={invalid}
              />
            )}
          />
        )}
      </FormSection>
      <SaveBar
        dirty={form.formState.isDirty}
        submitting={form.formState.isSubmitting}
        onReset={() => form.reset(availabilityValues(settings))}
      />
    </form>
  );
}

// ─────────────────────────── Mode de prix ───────────────────────────

export function PricingTab() {
  const query = usePricingSettings();
  return <Loaded query={query}>{(settings) => <PricingForm settings={settings} />}</Loaded>;
}

function PricingForm({ settings }: { settings: PricingSettings }) {
  const t = useTranslations('settings.pricing');
  const describeError = useErrorMessage();
  const save = useSavePricingSettings();
  const [mode, setMode] = useState(settings.priceEntryMode);
  const [confirming, setConfirming] = useState(false);
  const changed = mode !== settings.priceEntryMode;

  const apply = () =>
    save.mutate(
      { priceEntryMode: mode },
      {
        onSuccess: () => {
          toast.success(t('saved'));
          setConfirming(false);
        },
        onError: (error) => toast.error(describeError(error)),
      },
    );

  return (
    <div className="flex flex-col gap-4" data-testid="pricing-settings">
      <UnsavedChangesGuard when={changed} />
      <FormSection title={t('title')} description={t('hint')}>
        <div role="radiogroup" aria-label={t('title')} className="grid gap-2 sm:grid-cols-2">
          {(['TTC', 'HT'] as const).map((value) => {
            const selected = value === mode;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMode(value)}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border p-3 text-start transition-colors',
                  selected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  {selected && <CheckIcon className="size-4 text-primary" aria-hidden />}
                  {t(`modes.${value}.label`)}
                </span>
                <span className="text-sm text-muted-foreground">{t(`modes.${value}.hint`)}</span>
              </button>
            );
          })}
        </div>
        {!settings.isVatRegistered && <p className="text-sm text-muted-foreground">{t('noVat')}</p>}
        <div
          role="note"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t('warning')}</span>
        </div>
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={!changed}
            onClick={() => setMode(settings.priceEntryMode)}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!changed || save.isPending}
            onClick={() => setConfirming(true)}
          >
            {t('apply')}
          </Button>
        </div>
      </FormSection>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle', { mode })}</AlertDialogTitle>
            <AlertDialogDescription>{t('warning')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={save.isPending}
              onClick={(event) => {
                event.preventDefault();
                apply();
              }}
            >
              {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
