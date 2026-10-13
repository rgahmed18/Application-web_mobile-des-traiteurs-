'use client';

import { COLLECTION_METHODS, collectionMethodSchema, type Mission } from '@traiteur/shared';
import { BanknoteIcon, CameraIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormDialog } from '@/components/forms/form-dialog';
import { FormField } from '@/components/forms/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { amountToCents, centsToAmount } from '@/features/catalog/forms/form-values';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDateTime } from '@/lib/format/date';
import { currencyLabel, formatMoney } from '@/lib/format/money';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useMissionCollect } from './assignments-api';
import { COLLECTION_STATUS_STYLES } from './personnel-card';

type CashCollection = NonNullable<Mission['cashCollection']>;

/**
 * Montant à encaisser à la livraison : le seul montant montré au livreur, sur cette mission
 * seulement. « Encaissé » crée une déclaration en attente de remise à l'administrateur.
 */
export function MissionCashCard({ missionId, cash }: { missionId: string; cash: CashCollection }) {
  const t = useTranslations('assignments.cash');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const [open, setOpen] = useState(false);
  const declaration = cash.declaration;

  return (
    <Card className="border-amber-300 dark:border-amber-800" data-testid="mission-cash">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BanknoteIcon className="size-5 text-muted-foreground" aria-hidden />
          {t('missionTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-2xl font-semibold tabular-nums" data-testid="mission-cash-amount">
          {formatMoney(cash.amount, locale)}
          <span className="ms-2 text-base font-normal text-muted-foreground">
            {t(`methods.${cash.method}`)}
          </span>
        </p>
        {declaration && (
          <div className="flex flex-col gap-1 text-sm">
            <Badge
              variant="outline"
              className={`self-start ${COLLECTION_STATUS_STYLES[declaration.status]}`}
            >
              {t(`status.${declaration.status}`, {
                amount: formatMoney(declaration.amount, locale),
              })}
            </Badge>
            <span className="text-muted-foreground">
              {t('declaredAt', { date: formatDateTime(declaration.collectedAt, timeZone) })}
            </span>
            {declaration.status === 'REJECTED' && declaration.rejectReason && (
              <span className="text-destructive">
                {t('rejectedReason', { reason: declaration.rejectReason })}
              </span>
            )}
            {declaration.status === 'PENDING' && (
              <span className="text-muted-foreground">{t('pendingHint')}</span>
            )}
          </div>
        )}
        {cash.canDeclare ? (
          <Button size="lg" onClick={() => setOpen(true)}>
            <BanknoteIcon aria-hidden />
            {t('declare')}
          </Button>
        ) : (
          !declaration && <p className="text-sm text-muted-foreground">{t('notYet')}</p>
        )}
      </CardContent>
      {open && <CollectDialog missionId={missionId} cash={cash} onClose={() => setOpen(false)} />}
    </Card>
  );
}

const collectFormSchema = z
  .object({
    amount: z.string(),
    method: collectionMethodSchema,
    reference: z.string().max(100),
  })
  .refine((values) => amountToCents(values.amount) > 0, {
    path: ['amount'],
    params: { i18n: 'invalidAmount' },
  });

function CollectDialog({
  missionId,
  cash,
  onClose,
}: {
  missionId: string;
  cash: CashCollection;
  onClose: () => void;
}) {
  const t = useTranslations('assignments.cash');
  const locale = useLocale();
  const describeError = useErrorMessage();
  const collect = useMissionCollect(missionId);
  const [photo, setPhoto] = useState<File | null>(null);
  const form = useZodForm(collectFormSchema, {
    amount: centsToAmount(cash.amount),
    method: cash.method,
    reference: '',
  });
  const method = form.watch('method');
  const amount = amountToCents(form.watch('amount'));

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const cheque = values.method === 'CHEQUE';
      await collect.mutateAsync({
        amount: amountToCents(values.amount),
        method: values.method,
        reference: cheque && values.reference.trim() !== '' ? values.reference.trim() : null,
        photo: cheque ? photo : null,
      });
      toast.success(t('declared'));
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('dialogTitle')}
      dirty={form.formState.isDirty || photo !== null}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <p className="text-sm text-muted-foreground">{t('dialogDescription')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="amount"
          label={t('received')}
          description={
            amount > 0 && amount !== cash.amount
              ? t('differs', { amount: formatMoney(cash.amount, locale) })
              : undefined
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
          label={t('method')}
          render={(field) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLLECTION_METHODS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(`methods.${item}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      {method === 'CHEQUE' && (
        <>
          <FormField
            control={form.control}
            name="reference"
            label={t('chequeNumber')}
            render={(field, { invalid }) => (
              <Input {...field} dir="ltr" inputMode="numeric" aria-invalid={invalid} />
            )}
          />
          <div className="flex flex-col gap-2">
            <label htmlFor="cheque-photo" className="text-sm font-medium">
              {t('photo')}
            </label>
            <Input
              id="cheque-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <CameraIcon className="size-3.5" aria-hidden />
              {t('photoHint')}
            </p>
          </div>
        </>
      )}
    </FormDialog>
  );
}
