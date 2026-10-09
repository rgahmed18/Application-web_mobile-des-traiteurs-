'use client';

import {
  discountsForTargetTotal,
  formatTaxRate,
  grossTotalTtc,
  type PriceMode,
} from '@traiteur/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { type Control, type FieldValues, type UseFormSetValue, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldDescription, FieldError } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { amountToCents, centsToAmount, toInteger } from '@/features/catalog/forms/form-values';
import { currencyLabel, formatMoney } from '@/lib/format/money';

import { liveTotals, type OrderFormValues } from './order-form-schema';

interface TotalsPanelProps {
  control: Control<OrderFormValues, unknown, FieldValues>;
  setValue: UseFormSetValue<OrderFormValues>;
  priceMode: PriceMode;
  disabled: boolean;
}

/** Totaux HT / TVA par taux / TTC en direct, et arrondi du total sur les remises de ligne. */
export function TotalsPanel({ control, setValue, priceMode, disabled }: TotalsPanelProps) {
  const t = useTranslations('orders.form');
  const tc = useTranslations('common');
  const locale = useLocale();
  const lines = useWatch({ control, name: 'lines' });
  const totals = liveTotals(priceMode, lines);
  const [rounding, setRounding] = useState(false);
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Lignes complètes (prix et quantité lisibles) : seules à pouvoir porter une remise
  const roundable = lines.flatMap((line, index) => {
    const unitPrice = amountToCents(line.unitPrice);
    const quantity = toInteger(line.quantity);
    return Number.isFinite(unitPrice) && Number.isFinite(quantity) && quantity > 0
      ? [{ index, unitPrice, quantity, taxRateBps: Number(line.taxRateBps) }]
      : [];
  });
  const maxTotal = grossTotalTtc(priceMode, roundable);

  const apply = () => {
    const cents = amountToCents(target);
    if (!Number.isFinite(cents) || cents < 0) {
      setError(t('round.tooHigh'));
      return;
    }
    if (cents > maxTotal) {
      setError(t('round.tooHigh'));
      return;
    }
    const result = discountsForTargetTotal(priceMode, roundable, cents);
    roundable.forEach((line, position) => {
      const discount = result.discounts[position] ?? 0;
      setValue(`lines.${line.index}.discount`, discount === 0 ? '' : centsToAmount(discount), {
        shouldDirty: true,
        shouldValidate: true,
      });
    });
    if (result.exact) toast.success(t('round.applied'));
    else toast.warning(t('round.notExact', { amount: formatMoney(result.totalTtc, locale) }));
    setRounding(false);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4" data-testid="order-totals">
      <p className="text-lg font-semibold">{t('totals.title')}</p>
      <dl className="flex flex-col gap-1.5">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t('totals.ht')}</dt>
          <dd className="tabular-nums" dir="ltr">
            {formatMoney(totals.totalHt, locale)}
          </dd>
        </div>
        {totals.taxBreakdown.map((entry) => (
          <div key={entry.taxRateBps} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {t('totals.tax', { rate: formatTaxRate(entry.taxRateBps) })}
            </dt>
            <dd className="tabular-nums" dir="ltr">
              {formatMoney(entry.taxAmount, locale)}
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t pt-2 text-lg font-semibold">
          <dt>{t('totals.ttc')}</dt>
          <dd className="tabular-nums" dir="ltr" data-testid="order-total-ttc">
            {formatMoney(totals.totalTtc, locale)}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">{t('totals.priceMode', { mode: priceMode })}</p>
      {!disabled && roundable.length > 0 && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setTarget(centsToAmount(totals.totalTtc));
            setError(null);
            setRounding(true);
          }}
        >
          {t('totals.round')}
        </Button>
      )}

      <Dialog open={rounding} onOpenChange={setRounding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('round.title')}</DialogTitle>
            <DialogDescription className="text-base">{t('round.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label htmlFor="round-target" className="font-medium">
              {t('round.target')}
            </label>
            <InputGroup>
              <InputGroupInput
                id="round-target"
                inputMode="decimal"
                dir="ltr"
                value={target}
                aria-invalid={error !== null}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    apply();
                  }
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{currencyLabel(locale)}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              {t('round.max', { amount: formatMoney(maxTotal, locale) })}
            </FieldDescription>
            {error && <FieldError>{error}</FieldError>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => setRounding(false)}>
              {tc('cancel')}
            </Button>
            <Button type="button" size="lg" onClick={apply}>
              {t('round.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
