'use client';

import {
  type CatalogSettings,
  COMMON_TAX_RATES_BPS,
  computeCatalogPrices,
  formatTaxRate,
  resolveTaxRate,
} from '@traiteur/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';

import { FormField } from '@/components/forms/form-field';
import { FieldDescription } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { currencyLabel, formatMoney } from '@/lib/format/money';

import { amountToCents, DEFAULT_TAX_RATE, toTaxRate } from './form-values';

interface PriceFieldsProps<TValues extends FieldValues> {
  control: Control<TValues, unknown, FieldValues>;
  settings: CatalogSettings;
  /** Champ du montant saisi (texte) et du taux (« default » ou points de base). */
  priceName: FieldPath<TValues>;
  taxRateName: FieldPath<TValues>;
  /** Valeurs courantes, pour l'équivalent affiché en direct. */
  priceValue: string;
  taxRateValue: string;
  perPerson?: boolean;
}

/**
 * Prix saisi dans le mode du traiteur (TTC ou HT) et taux de TVA. L'autre montant est affiché
 * en direct, calculé avec exactement la même règle que l'API (packages/shared/src/money).
 */
export function PriceFields<TValues extends FieldValues>({
  control,
  settings,
  priceName,
  taxRateName,
  priceValue,
  taxRateValue,
  perPerson = false,
}: PriceFieldsProps<TValues>) {
  const t = useTranslations('catalog.fields');
  const locale = useLocale();
  const ttcMode = settings.priceEntryMode === 'TTC';
  const label = perPerson
    ? t(ttcMode ? 'pricePerPersonTtc' : 'pricePerPersonHt')
    : t(ttcMode ? 'priceTtc' : 'priceHt');

  const cents = amountToCents(priceValue);
  const rate = resolveTaxRate(settings, toTaxRate(taxRateValue));
  const equivalent =
    Number.isFinite(cents) && cents >= 0 && settings.isVatRegistered
      ? computeCatalogPrices(cents, settings.priceEntryMode, rate)
      : null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        control={control}
        name={priceName}
        label={label}
        description={
          equivalent
            ? t(ttcMode ? 'equivalentHt' : 'equivalentTtc', {
                amount: formatMoney(ttcMode ? equivalent.priceHt : equivalent.priceTtc, locale),
              })
            : undefined
        }
        render={(field, { invalid }) => (
          <InputGroup>
            <InputGroupInput
              {...field}
              value={String(field.value ?? '')}
              inputMode="decimal"
              dir="ltr"
              placeholder="0,00"
              aria-invalid={invalid}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>{currencyLabel(locale)}</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        )}
      />
      <FormField
        control={control}
        name={taxRateName}
        label={t('taxRate')}
        render={(field) => (
          <Select
            value={String(field.value ?? DEFAULT_TAX_RATE)}
            onValueChange={field.onChange}
            disabled={!settings.isVatRegistered}
          >
            <SelectTrigger id={field.id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_TAX_RATE}>
                {t('taxRateDefault', { rate: formatTaxRate(settings.defaultTaxRateBps) })}
              </SelectItem>
              {COMMON_TAX_RATES_BPS.map((bps) => (
                <SelectItem key={bps} value={String(bps)}>
                  {formatTaxRate(bps)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {!settings.isVatRegistered && (
        <FieldDescription className="md:col-span-2">{t('notVatRegistered')}</FieldDescription>
      )}
    </div>
  );
}
