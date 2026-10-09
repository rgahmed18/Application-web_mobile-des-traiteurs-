'use client';

import {
  type CatalogSettings,
  type ExtraService,
  extraServiceInputSchema,
  PRICING_UNITS,
  pricingUnitSchema,
} from '@traiteur/shared';
import { useTranslations } from 'next-intl';
import { Controller, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useSaveExtraService } from '../catalog-api';
import { FormDialog } from '@/components/forms/form-dialog';
import {
  amountToCents,
  centsToAmount,
  DEFAULT_TAX_RATE,
  EMPTY_LOCALIZED,
  fromLocalizedText,
  fromTaxRate,
  localizedFormSchema,
  toLocalizedText,
  toOptionalLocalizedText,
  toTaxRate,
} from '../forms/form-values';
import { LocalizedTextFields } from '../forms/localized-text-fields';
import { PriceFields } from '../forms/price-fields';

export const serviceFormSchema = z
  .object({
    name: localizedFormSchema,
    description: localizedFormSchema,
    price: z.string(),
    taxRateBps: z.string(),
    pricingUnit: pricingUnitSchema,
    isActive: z.boolean(),
  })
  .transform((values) => ({
    name: toLocalizedText(values.name),
    description: toOptionalLocalizedText(values.description),
    price: amountToCents(values.price),
    taxRateBps: toTaxRate(values.taxRateBps),
    pricingUnit: values.pricingUnit,
    isActive: values.isActive,
  }))
  .pipe(extraServiceInputSchema);

type ServiceFormValues = z.input<typeof serviceFormSchema>;

function toFormValues(
  service: ExtraService | undefined,
  settings: CatalogSettings,
): ServiceFormValues {
  if (!service) {
    return {
      name: EMPTY_LOCALIZED,
      description: EMPTY_LOCALIZED,
      price: '',
      taxRateBps: DEFAULT_TAX_RATE,
      pricingUnit: 'FLAT',
      isActive: true,
    };
  }
  return {
    name: fromLocalizedText(service.name),
    description: fromLocalizedText(service.description),
    price: centsToAmount(settings.priceEntryMode === 'TTC' ? service.priceTtc : service.priceHt),
    taxRateBps: fromTaxRate(service.taxRateBps),
    pricingUnit: service.pricingUnit,
    isActive: service.isActive,
  };
}

interface ServiceFormDialogProps {
  settings: CatalogSettings;
  service?: ExtraService;
  onClose: () => void;
}

/** Création ou modification d'un service (décoration, serveurs, location de vaisselle…). */
export function ServiceFormDialog({ settings, service, onClose }: ServiceFormDialogProps) {
  const t = useTranslations('catalog');
  const describeError = useErrorMessage();
  const save = useSaveExtraService();
  const form = useZodForm(serviceFormSchema, toFormValues(service, settings));
  const [price, taxRate] = useWatch({ control: form.control, name: ['price', 'taxRateBps'] });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: service?.id ?? null, input });
      toast.success(t('services.saved'));
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t(service ? 'services.editTitle' : 'services.newTitle')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <LocalizedTextFields
        control={form.control}
        name="name"
        labelFr={t('fields.nameFr')}
        labelAr={t('fields.nameAr')}
      />
      <LocalizedTextFields
        control={form.control}
        name="description"
        labelFr={t('fields.descriptionFr')}
        labelAr={t('fields.descriptionAr')}
        multiline
      />
      <PriceFields
        control={form.control}
        settings={settings}
        priceName="price"
        taxRateName="taxRateBps"
        priceValue={price}
        taxRateValue={taxRate}
      />
      <FormField
        control={form.control}
        name="pricingUnit"
        label={t('services.pricingUnit')}
        render={(field) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id={field.id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRICING_UNITS.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {t(`pricingUnits.${unit}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <Controller
        control={form.control}
        name="isActive"
        render={({ field }) => (
          <Field orientation="horizontal">
            <Switch id="service-active" checked={field.value} onCheckedChange={field.onChange} />
            <FieldLabel htmlFor="service-active" className="text-base">
              {t('services.active')}
            </FieldLabel>
          </Field>
        )}
      />
    </FormDialog>
  );
}
