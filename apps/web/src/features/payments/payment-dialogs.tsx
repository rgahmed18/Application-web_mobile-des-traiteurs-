'use client';

import {
  depositUpdateSchema,
  PAYMENT_METHODS,
  paymentInputSchema,
  paymentMethodSchema,
} from '@traiteur/shared';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormDialog } from '@/components/forms/form-dialog';
import { FormField } from '@/components/forms/form-field';
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
import { useErrorMessage } from '@/lib/api/use-error-message';
import { currencyLabel, formatMoney } from '@/lib/format/money';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useRecordPayment, useRefund, useSetDeposit } from './payments-api';

const nullable = (value: string) => (value.trim() === '' ? null : value.trim());

const paymentFormSchema = z
  .object({
    amount: z.string(),
    method: paymentMethodSchema,
    reference: z.string(),
    paidOn: z.string(),
    notes: z.string(),
  })
  .transform((values): z.input<typeof paymentInputSchema> => ({
    amount: amountToCents(values.amount),
    method: values.method,
    reference: nullable(values.reference),
    paidOn: values.paidOn,
    notes: nullable(values.notes),
  }))
  .pipe(paymentInputSchema);

interface PaymentDialogProps {
  orderId: string;
  mode: 'payment' | 'refund';
  /** Montant proposé (reste à payer, ou payé net pour un remboursement). */
  suggested: number;
  today: string;
  onClose: () => void;
}

/** Encaissement (ou remboursement) manuel : montant, mode, référence, date. */
export function PaymentDialog({ orderId, mode, suggested, today, onClose }: PaymentDialogProps) {
  const t = useTranslations('payments');
  const locale = useLocale();
  const describeError = useErrorMessage();
  const record = useRecordPayment(orderId);
  const refund = useRefund(orderId);
  const form = useZodForm(paymentFormSchema, {
    amount: suggested > 0 ? centsToAmount(suggested) : '',
    method: mode === 'refund' ? 'BANK_TRANSFER' : 'CASH',
    reference: '',
    paidOn: today,
    notes: '',
  });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      if (mode === 'refund') {
        await refund.mutateAsync(input);
        toast.success(t('form.refundRecorded'));
      } else {
        const state = await record.mutateAsync(input);
        const number = state.payments.at(-1)?.receiptNumber ?? '';
        toast.success(t('form.recorded', { number }));
      }
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t(mode === 'refund' ? 'form.refundTitle' : 'form.recordTitle')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="amount"
          label={t('form.amount')}
          description={
            mode === 'refund'
              ? t('form.refundHint', { amount: formatMoney(suggested, locale) })
              : t('form.amountHint', { amount: formatMoney(suggested, locale) })
          }
          render={(field, { invalid }) => (
            <InputGroup>
              <InputGroupInput {...field} inputMode="decimal" dir="ltr" aria-invalid={invalid} />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{currencyLabel(locale)}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          )}
        />
        <FormField
          control={form.control}
          name="method"
          label={t('form.method')}
          render={(field) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {t(`methods.${method}`)}
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
          name="reference"
          label={t('form.reference')}
          description={t('form.referenceHint')}
          render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
        />
        <FormField
          control={form.control}
          name="paidOn"
          label={t('form.date')}
          render={(field, { invalid }) => (
            <Input {...field} type="date" max={today} dir="ltr" aria-invalid={invalid} />
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="notes"
        label={t('form.notes')}
        render={(field, { invalid }) => <Textarea {...field} rows={2} aria-invalid={invalid} />}
      />
    </FormDialog>
  );
}

const depositFormSchema = z
  .object({ amount: z.string() })
  .transform((values) => ({ depositAmount: amountToCents(values.amount) }))
  .pipe(depositUpdateSchema);

/** Acompte demandé (figé à la confirmation, ajustable par le traiteur). */
export function DepositDialog({
  orderId,
  current,
  onClose,
}: {
  orderId: string;
  current: number;
  onClose: () => void;
}) {
  const t = useTranslations('payments.depositDialog');
  const locale = useLocale();
  const describeError = useErrorMessage();
  const save = useSetDeposit(orderId);
  const form = useZodForm(depositFormSchema, { amount: centsToAmount(current) });
  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync(input);
      toast.success(t('saved'));
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });
  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('title')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <FormField
        control={form.control}
        name="amount"
        label={t('amount')}
        description={t('description')}
        render={(field, { invalid }) => (
          <InputGroup className="sm:w-64">
            <InputGroupInput {...field} inputMode="decimal" dir="ltr" aria-invalid={invalid} />
            <InputGroupAddon align="inline-end">
              <InputGroupText>{currencyLabel(locale)}</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        )}
      />
    </FormDialog>
  );
}
