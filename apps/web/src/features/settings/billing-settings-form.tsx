'use client';

import {
  type BillingSettings,
  billingSettingsInputSchema,
  COMMON_TAX_RATES_BPS,
  CREDIT_NOTE_NUMBERINGS,
  formatTaxRate,
} from '@traiteur/shared';
import { ImageIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { UnsavedChangesGuard } from '@/components/forms/unsaved-changes-guard';
import { LoadError } from '@/components/layout/load-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { FormSection } from '@/features/catalog/components/form-layout';
import { toInteger } from '@/features/catalog/forms/form-values';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import {
  useBillingSettings,
  useRemoveLogo,
  useSaveBillingSettings,
  useUploadLogo,
} from './settings-api';

const DEFAULT_RATE = 'default';
const nullable = (value: string) => (value.trim() === '' ? null : value.trim());
const localized = (fr: string, ar: string) =>
  fr.trim() === '' ? null : ar.trim() === '' ? { fr: fr.trim() } : { fr: fr.trim(), ar: ar.trim() };

/** Pourcentage saisi (« 30 », « 12,5 ») → points de base ; NaN si illisible. */
function percentToBps(value: string): number {
  const normalized = value.trim().replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : Number.NaN;
}

/** Mentions légales saisies comme du texte libre. */
type TextField =
  | 'legalName'
  | 'legalForm'
  | 'ice'
  | 'rcNumber'
  | 'rcCourt'
  | 'taxId'
  | 'patenteNumber'
  | 'cnssNumber'
  | 'legalAddress'
  | 'bankName'
  | 'rib'
  | 'invoiceFooter';

const formSchema = z
  .object({
    depositPercent: z.string(),
    balanceDueDays: z.string(),
    quoteValidityDays: z.string(),
    cancellationFeeTaxRate: z.string(),
    creditNoteNumbering: z.enum(CREDIT_NOTE_NUMBERINGS),
    shareCapital: z.string(),
    quoteTermsFr: z.string(),
    quoteTermsAr: z.string(),
    paymentTermsFr: z.string(),
    paymentTermsAr: z.string(),
    legalName: z.string(),
    legalForm: z.string(),
    ice: z.string(),
    rcNumber: z.string(),
    rcCourt: z.string(),
    taxId: z.string(),
    patenteNumber: z.string(),
    cnssNumber: z.string(),
    legalAddress: z.string(),
    bankName: z.string(),
    rib: z.string(),
    invoiceFooter: z.string(),
  })
  .transform((values): z.input<typeof billingSettingsInputSchema> => ({
    depositPercentBps: percentToBps(values.depositPercent),
    balanceDueDays: toInteger(values.balanceDueDays),
    quoteValidityDays: toInteger(values.quoteValidityDays),
    cancellationFeeTaxRateBps:
      values.cancellationFeeTaxRate === DEFAULT_RATE ? null : Number(values.cancellationFeeTaxRate),
    creditNoteNumbering: values.creditNoteNumbering,
    shareCapital: values.shareCapital.trim() === '' ? null : toInteger(values.shareCapital),
    quoteTerms: localized(values.quoteTermsFr, values.quoteTermsAr),
    paymentTerms: localized(values.paymentTermsFr, values.paymentTermsAr),
    legalName: nullable(values.legalName),
    legalForm: nullable(values.legalForm),
    ice: nullable(values.ice),
    rcNumber: nullable(values.rcNumber),
    rcCourt: nullable(values.rcCourt),
    taxId: nullable(values.taxId),
    patenteNumber: nullable(values.patenteNumber),
    cnssNumber: nullable(values.cnssNumber),
    legalAddress: nullable(values.legalAddress),
    bankName: nullable(values.bankName),
    rib: nullable(values.rib),
    invoiceFooter: nullable(values.invoiceFooter),
  }))
  .pipe(billingSettingsInputSchema);

type FormValues = z.input<typeof formSchema>;

function toFormValues(settings: BillingSettings): FormValues {
  return {
    depositPercent: String(settings.depositPercentBps / 100).replace('.', ','),
    balanceDueDays: String(settings.balanceDueDays),
    quoteValidityDays: String(settings.quoteValidityDays),
    cancellationFeeTaxRate:
      settings.cancellationFeeTaxRateBps === null
        ? DEFAULT_RATE
        : String(settings.cancellationFeeTaxRateBps),
    creditNoteNumbering: settings.creditNoteNumbering,
    shareCapital: settings.shareCapital === null ? '' : String(settings.shareCapital),
    quoteTermsFr: settings.quoteTerms?.fr ?? '',
    quoteTermsAr: settings.quoteTerms?.ar ?? '',
    paymentTermsFr: settings.paymentTerms?.fr ?? '',
    paymentTermsAr: settings.paymentTerms?.ar ?? '',
    legalName: settings.legalName ?? '',
    legalForm: settings.legalForm ?? '',
    ice: settings.ice ?? '',
    rcNumber: settings.rcNumber ?? '',
    rcCourt: settings.rcCourt ?? '',
    taxId: settings.taxId ?? '',
    patenteNumber: settings.patenteNumber ?? '',
    cnssNumber: settings.cnssNumber ?? '',
    legalAddress: settings.legalAddress ?? '',
    bankName: settings.bankName ?? '',
    rib: settings.rib ?? '',
    invoiceFooter: settings.invoiceFooter ?? '',
  };
}

function LogoField({ settings }: { settings: BillingSettings }) {
  const t = useTranslations('settings.billing');
  const describeError = useErrorMessage();
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-2 text-muted-foreground">
        <ImageIcon className="size-5" aria-hidden />
        {settings.hasLogo ? t('hasLogo') : t('noLogo')}
      </span>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          upload.mutate(file, {
            onSuccess: () => toast.success(t('logoSaved')),
            onError: (error) => toast.error(describeError(error)),
          });
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={upload.isPending}
        onClick={() => input.current?.click()}
      >
        <UploadIcon aria-hidden />
        {t('uploadLogo')}
      </Button>
      {settings.hasLogo && (
        <Button
          type="button"
          variant="ghost"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(undefined, { onError: (error) => toast.error(describeError(error)) })
          }
        >
          <Trash2Icon aria-hidden />
          {t('removeLogo')}
        </Button>
      )}
      <p className="w-full text-sm text-muted-foreground">{t('logoHint')}</p>
    </div>
  );
}

/** Partie du réglage affichée : l'onglet Entreprise (mentions légales) ou Documents et paiements. */
export type BillingSection = 'legal' | 'documents';

function BillingForm({
  settings,
  section,
}: {
  settings: BillingSettings;
  section: BillingSection;
}) {
  const t = useTranslations('settings.billing');
  const tc = useTranslations('common');
  const describeError = useErrorMessage();
  const save = useSaveBillingSettings();
  const form = useZodForm(formSchema, toFormValues(settings));

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      const saved = await save.mutateAsync(input);
      form.reset(toFormValues(saved));
      toast.success(t('saved'));
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  const text = (name: TextField, options: { dir?: 'ltr' | 'auto' } = {}) => (
    <FormField
      control={form.control}
      name={name}
      label={t(name)}
      render={(field, { invalid }) => (
        <Input {...field} dir={options.dir ?? 'auto'} aria-invalid={invalid} />
      )}
    />
  );

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-6"
      data-testid={`billing-settings-${section}`}
    >
      <UnsavedChangesGuard when={form.formState.isDirty} />
      {section === 'documents' && (
        <>
          <FormSection title={t('schedule')}>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="depositPercent"
                label={t('depositPercent')}
                description={t('depositPercentHint')}
                render={(field, { invalid }) => (
                  <Input {...field} inputMode="decimal" dir="ltr" aria-invalid={invalid} />
                )}
              />
              <FormField
                control={form.control}
                name="balanceDueDays"
                label={t('balanceDueDays')}
                description={t('balanceDueDaysHint')}
                render={(field, { invalid }) => (
                  <Input {...field} inputMode="numeric" dir="ltr" aria-invalid={invalid} />
                )}
              />
              <FormField
                control={form.control}
                name="quoteValidityDays"
                label={t('quoteValidityDays')}
                render={(field, { invalid }) => (
                  <Input {...field} inputMode="numeric" dir="ltr" aria-invalid={invalid} />
                )}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="quoteTermsFr"
                label={`${t('quoteTerms')} — FR`}
                description={t('quoteTermsHint')}
                render={(field, { invalid }) => (
                  <Textarea {...field} rows={4} dir="ltr" lang="fr" aria-invalid={invalid} />
                )}
              />
              <FormField
                control={form.control}
                name="quoteTermsAr"
                label={`${t('quoteTerms')} — AR`}
                render={(field, { invalid }) => (
                  <Textarea {...field} rows={4} dir="rtl" lang="ar" aria-invalid={invalid} />
                )}
              />
            </div>
          </FormSection>

          <FormSection title={t('invoicing')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="cancellationFeeTaxRate"
                label={t('cancellationFeeTaxRate')}
                render={(field) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!settings.isVatRegistered}
                  >
                    <SelectTrigger id={field.id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_RATE}>
                        {t('defaultRate', { rate: formatTaxRate(settings.defaultTaxRateBps) })}
                      </SelectItem>
                      {COMMON_TAX_RATES_BPS.map((rate) => (
                        <SelectItem key={rate} value={String(rate)}>
                          {formatTaxRate(rate)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FormField
                control={form.control}
                name="creditNoteNumbering"
                label={t('creditNoteNumbering')}
                description={t('numberingHint')}
                render={(field) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={field.id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CREDIT_NOTE_NUMBERINGS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`numbering.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="paymentTermsFr"
                label={`${t('paymentTerms')} — FR`}
                render={(field, { invalid }) => (
                  <Textarea {...field} rows={3} dir="ltr" lang="fr" aria-invalid={invalid} />
                )}
              />
              <FormField
                control={form.control}
                name="paymentTermsAr"
                label={`${t('paymentTerms')} — AR`}
                render={(field, { invalid }) => (
                  <Textarea {...field} rows={3} dir="rtl" lang="ar" aria-invalid={invalid} />
                )}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
              {text('bankName')}
              {text('rib', { dir: 'ltr' })}
            </div>
            {text('invoiceFooter')}
          </FormSection>
        </>
      )}

      {section === 'legal' && (
        <FormSection title={t('legal')} description={t('legalHint')}>
          <LogoField settings={settings} />
          <div className="grid gap-4 sm:grid-cols-3">
            {text('legalName')}
            {text('legalForm')}
            <FormField
              control={form.control}
              name="shareCapital"
              label={t('shareCapital')}
              render={(field, { invalid }) => (
                <Input {...field} inputMode="numeric" dir="ltr" aria-invalid={invalid} />
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {text('ice', { dir: 'ltr' })}
            {text('taxId', { dir: 'ltr' })}
            {text('patenteNumber', { dir: 'ltr' })}
            {text('rcNumber', { dir: 'ltr' })}
            {text('rcCourt')}
            {text('cnssNumber', { dir: 'ltr' })}
          </div>
          {text('legalAddress')}
        </FormSection>
      )}

      <div
        className={
          section === 'documents'
            ? 'sticky bottom-0 z-10 -mx-4 flex justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6'
            : 'flex justify-end gap-3'
        }
      >
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={!form.formState.isDirty}
          onClick={() => form.reset(toFormValues(settings))}
        >
          {tc('cancel')}
        </Button>
        <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? tc('saving') : tc('save')}
        </Button>
      </div>
    </form>
  );
}

/** Réglages « Documents et paiements » (ou mentions légales de l'onglet Entreprise). */
export function BillingSettingsTab({ section }: { section: BillingSection }) {
  const settings = useBillingSettings();
  if (settings.isPending) return <Skeleton className="h-96 w-full" />;
  if (!settings.data) return <LoadError error={settings.error} backHref="/admin" />;
  return <BillingForm settings={settings.data} section={section} />;
}
