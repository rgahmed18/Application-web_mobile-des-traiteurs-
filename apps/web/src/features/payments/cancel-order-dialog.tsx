'use client';

import { type CancellationRefund, PAYMENT_METHODS, type PaymentMethod } from '@traiteur/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Textarea } from '@/components/ui/textarea';
import { amountToCents, centsToAmount } from '@/features/catalog/forms/form-values';
import { currencyLabel, formatMoney } from '@/lib/format/money';

interface CancelOrderDialogProps {
  open: boolean;
  reference: string;
  /** Payé net : s'il est positif, le traiteur choisit le montant remboursé. */
  paid: number;
  today: string;
  pending: boolean;
  onConfirm: (reason: string, refund: CancellationRefund | null) => void;
  onCancel: () => void;
}

/**
 * Annulation d'une commande : motif obligatoire, avertissement sur les paiements et, si la
 * commande est payée, montant remboursé (le reste est conservé comme frais d'annulation).
 */
export function CancelOrderDialog({
  open,
  reference,
  paid,
  today,
  pending,
  onConfirm,
  onCancel,
}: CancelOrderDialogProps) {
  const t = useTranslations('orders.cancel');
  const tp = useTranslations('payments');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const locale = useLocale();
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(centsToAmount(paid));
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [date, setDate] = useState(today);
  const [touched, setTouched] = useState(false);

  const refundCents = paid > 0 ? amountToCents(amount) : 0;
  const amountInvalid =
    paid > 0 && (!Number.isFinite(refundCents) || refundCents < 0 || refundCents > paid);
  const reasonMissing = reason.trim() === '';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (reasonMissing || amountInvalid) return;
            onConfirm(
              reason.trim(),
              paid > 0 ? { amount: refundCents, method, reference: null, paidOn: date } : null,
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('title', { reference })}</DialogTitle>
            <DialogDescription className="text-base">{t('description')}</DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {t('refundWarning')}
          </p>
          <label className="flex flex-col gap-2">
            <span className="font-medium">{t('reason')}</span>
            <Textarea
              rows={3}
              value={reason}
              placeholder={t('placeholder')}
              aria-invalid={touched && reasonMissing}
              onChange={(event) => setReason(event.target.value)}
            />
            {touched && reasonMissing && <FieldError>{tv('required')}</FieldError>}
          </label>

          {paid > 0 && (
            <fieldset
              className="flex flex-col gap-3 rounded-lg border p-3"
              data-testid="cancel-refund"
            >
              <legend className="px-1 font-medium">{tp('cancellation.title')}</legend>
              <p className="text-sm text-muted-foreground">
                {tp('cancellation.paid', { amount: formatMoney(paid, locale) })}
              </p>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">{tp('cancellation.amount')}</span>
                <InputGroup className="sm:w-64">
                  <InputGroupInput
                    inputMode="decimal"
                    dir="ltr"
                    value={amount}
                    aria-invalid={touched && amountInvalid}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{currencyLabel(locale)}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                {touched && amountInvalid && (
                  <FieldError>
                    {tp('form.refundHint', { amount: formatMoney(paid, locale) })}
                  </FieldError>
                )}
              </label>
              {!amountInvalid && (
                <p className="text-sm font-medium" data-testid="cancel-fee">
                  {tp('cancellation.fee', { amount: formatMoney(paid - refundCents, locale) })}
                </p>
              )}
              {refundCents > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{tp('cancellation.method')}</span>
                    <Select
                      value={method}
                      onValueChange={(value) => setMethod(value as PaymentMethod)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {tp(`methods.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{tp('cancellation.date')}</span>
                    <Input
                      type="date"
                      dir="ltr"
                      max={today}
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </label>
                </div>
              )}
            </fieldset>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onCancel}>
              {t('keep')}
            </Button>
            <Button type="submit" size="lg" variant="destructive" disabled={pending}>
              {t('confirm')}
            </Button>
          </DialogFooter>
          <span className="sr-only">{tc('close')}</span>
        </form>
      </DialogContent>
    </Dialog>
  );
}
