'use client';

import {
  COMMON_TAX_RATES_BPS,
  formatTaxRate,
  type LineItemType,
  type Locale,
  type PriceMode,
} from '@traiteur/shared';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  type Control,
  Controller,
  type FieldValues,
  useFieldArray,
  useFormState,
  useWatch,
} from 'react-hook-form';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { centsToAmount } from '@/features/catalog/forms/form-values';
import { currencyLabel, formatMoney } from '@/lib/format/money';

import { type CatalogChoice, CatalogPicker } from './catalog-picker';
import { lineAmounts, newLineKey, type OrderFormValues } from './order-form-schema';

type CatalogKind = Exclude<LineItemType, 'CUSTOM'>;

interface LinesEditorProps {
  control: Control<OrderFormValues, unknown, FieldValues>;
  priceMode: PriceMode;
  isVatRegistered: boolean;
  defaultTaxRateBps: number;
  labelLocale: Locale;
  disabled: boolean;
}

/** Prestations de la commande : formules, plats, services et lignes libres, avec remises. */
export function LinesEditor({
  control,
  priceMode,
  isVatRegistered,
  defaultTaxRateBps,
  labelLocale,
  disabled,
}: LinesEditorProps) {
  const t = useTranslations('orders.form.lines');
  const locale = useLocale();
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: 'lines',
    keyName: 'fieldKey',
  });
  const lines = useWatch({ control, name: 'lines' });
  const guestCount = useWatch({ control, name: 'guestCount' });
  const { errors } = useFormState({ control, name: 'lines' });
  const [picking, setPicking] = useState<CatalogKind | null>(null);

  const guests = /^\d+$/.test(guestCount.trim()) ? Number(guestCount) : null;
  const taxRates = isVatRegistered ? [...COMMON_TAX_RATES_BPS] : [0];
  const unitPriceLabel = priceMode === 'TTC' ? t('unitPriceTTC') : t('unitPriceHT');

  const addFromCatalog = (choice: CatalogChoice) => {
    const quantity =
      choice.perPerson && guests ? Math.max(guests, choice.minQuantity) : choice.minQuantity;
    append({
      key: newLineKey(),
      itemType: choice.itemType,
      dishId: choice.itemType === 'DISH' ? choice.id : null,
      packageId: choice.itemType === 'PACKAGE' ? choice.id : null,
      extraServiceId: choice.itemType === 'EXTRA_SERVICE' ? choice.id : null,
      label: choice.label,
      quantity: String(quantity),
      unitPrice: centsToAmount(choice.unitPrice),
      discount: '',
      taxRateBps: String(isVatRegistered ? choice.taxRateBps : 0),
      perPerson: choice.perPerson,
      notes: '',
    });
    setPicking(null);
  };

  const addCustom = () =>
    append({
      key: newLineKey(),
      itemType: 'CUSTOM',
      dishId: null,
      packageId: null,
      extraServiceId: null,
      label: '',
      quantity: '1',
      unitPrice: '',
      discount: '',
      taxRateBps: String(isVatRegistered ? defaultTaxRateBps : 0),
      perPerson: false,
      notes: '',
    });

  const listError = errors.lines?.root?.message ?? errors.lines?.message;

  return (
    <div className="flex flex-col gap-4">
      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ol className="flex flex-col gap-3" data-testid="order-lines">
          {fields.map((field, index) => {
            const line = lines[index];
            const amounts = line ? lineAmounts(priceMode, line) : null;
            const lineErrors = errors.lines?.[index];
            const error = (name: 'label' | 'quantity' | 'unitPrice' | 'discount') =>
              lineErrors?.[name]?.message;
            const id = (name: string) => `line-${index}-${name}`;
            return (
              <li key={field.fieldKey} className="flex flex-col gap-3 rounded-xl border p-3 sm:p-4">
                <div className="flex items-start gap-2">
                  <Badge variant="secondary" className="mt-2.5 shrink-0">
                    {t(`types.${field.itemType}`)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={t('label')}
                      placeholder={t('label')}
                      disabled={disabled}
                      aria-invalid={Boolean(error('label'))}
                      {...control.register(`lines.${index}.label`)}
                    />
                    {error('label') && <FieldError>{error('label')}</FieldError>}
                  </div>
                  <div className="flex shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('moveUp')}
                      disabled={disabled || index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUpIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('moveDown')}
                      disabled={disabled || index === fields.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDownIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('remove')} — ${line?.label ?? ''}`}
                      disabled={disabled}
                      onClick={() => remove(index)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-[6rem_minmax(0,1fr)_7rem_minmax(0,1fr)]">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={id('quantity')} className="text-sm text-muted-foreground">
                      {t('quantity')}
                    </label>
                    <Input
                      id={id('quantity')}
                      inputMode="numeric"
                      dir="ltr"
                      disabled={disabled}
                      aria-invalid={Boolean(error('quantity'))}
                      {...control.register(`lines.${index}.quantity`)}
                    />
                    {error('quantity') && <FieldError>{error('quantity')}</FieldError>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={id('unitPrice')} className="text-sm text-muted-foreground">
                      {unitPriceLabel}
                    </label>
                    <InputGroup>
                      <InputGroupInput
                        id={id('unitPrice')}
                        inputMode="decimal"
                        dir="ltr"
                        placeholder="0,00"
                        disabled={disabled}
                        aria-invalid={Boolean(error('unitPrice'))}
                        {...control.register(`lines.${index}.unitPrice`)}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>{currencyLabel(locale)}</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                    {error('unitPrice') && <FieldError>{error('unitPrice')}</FieldError>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span id={id('tax')} className="text-sm text-muted-foreground">
                      {t('taxRate')}
                    </span>
                    <Controller
                      control={control}
                      name={`lines.${index}.taxRateBps`}
                      render={({ field: taxField }) => (
                        <Select
                          value={taxField.value}
                          onValueChange={taxField.onChange}
                          disabled={disabled || !isVatRegistered}
                        >
                          <SelectTrigger className="w-full" aria-labelledby={id('tax')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[...new Set([...taxRates, Number(taxField.value)])]
                              .filter((rate) => Number.isFinite(rate))
                              .sort((a, b) => a - b)
                              .map((rate) => (
                                <SelectItem key={rate} value={String(rate)}>
                                  {formatTaxRate(rate)}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={id('discount')} className="text-sm text-muted-foreground">
                      {t('discount')}
                    </label>
                    <Input
                      id={id('discount')}
                      dir="ltr"
                      placeholder="0,00 / 10 %"
                      disabled={disabled}
                      aria-invalid={Boolean(error('discount'))}
                      {...control.register(`lines.${index}.discount`)}
                    />
                    {error('discount') && <FieldError>{error('discount')}</FieldError>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Controller
                    control={control}
                    name={`lines.${index}.perPerson`}
                    render={({ field: perPerson }) => (
                      <label className="flex items-center gap-2 text-sm" title={t('perPersonHint')}>
                        <Checkbox
                          checked={perPerson.value}
                          disabled={disabled}
                          onCheckedChange={(checked) => perPerson.onChange(checked === true)}
                        />
                        {t('perPerson')}
                      </label>
                    )}
                  />
                  <p className="text-sm">
                    <span className="text-muted-foreground">{t('lineTotal')} : </span>
                    <span className="font-semibold tabular-nums" dir="ltr" data-testid="line-total">
                      {amounts
                        ? formatMoney(
                            priceMode === 'TTC' ? amounts.totalTtc : amounts.totalHt,
                            locale,
                          )
                        : '—'}
                    </span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {listError && <FieldError>{listError}</FieldError>}

      {!disabled && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="self-start">
              <PlusIcon aria-hidden />
              {t('add')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem className="py-2.5 text-base" onSelect={() => setPicking('PACKAGE')}>
              {t('addPackage')}
            </DropdownMenuItem>
            <DropdownMenuItem className="py-2.5 text-base" onSelect={() => setPicking('DISH')}>
              {t('addDish')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="py-2.5 text-base"
              onSelect={() => setPicking('EXTRA_SERVICE')}
            >
              {t('addService')}
            </DropdownMenuItem>
            <DropdownMenuItem className="py-2.5 text-base" onSelect={addCustom}>
              {t('addCustom')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {picking && (
        <CatalogPicker
          kind={picking}
          priceMode={priceMode}
          labelLocale={labelLocale}
          onPick={addFromCatalog}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
