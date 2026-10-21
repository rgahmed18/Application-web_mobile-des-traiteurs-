'use client';

import {
  ASSIGNMENT_ROLES,
  type Assignment,
  type AssignmentConflict,
  assignmentConflictSchema,
  COLLECTION_METHODS,
  type Order,
  serviceInfoSchema,
} from '@traiteur/shared';
import {
  BanknoteIcon,
  ChefHatIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  TriangleAlertIcon,
  TrashIcon,
  TruckIcon,
  UserRoundCogIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormDialog } from '@/components/forms/form-dialog';
import { FormField } from '@/components/forms/form-field';
import { PhoneInput } from '@/components/forms/phone-input';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { usePermission } from '@/features/auth/session-provider';
import { amountToCents, centsToAmount } from '@/features/catalog/forms/form-values';
import { openDocument } from '@/features/payments/payments-api';
import { useStaff } from '@/features/staff/staff-api';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { currencyLabel, formatMoney } from '@/lib/format/money';
import { useZodForm } from '@/lib/forms/use-zod-form';
import { cn } from '@/lib/utils';

import { CASH_ROLES, formatMoment } from './assignment-times';
import { BatchAssignmentDialog } from './batch-assignment-dialog';
import {
  useOrderStaffing,
  useRemoveAssignment,
  useUpdateAssignment,
  useUpdateServiceInfo,
} from './assignments-api';

export const ASSIGNMENT_STATUS_STYLES: Record<Assignment['status'], string> = {
  ASSIGNED: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  CONFIRMED:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  DECLINED: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
  DONE: 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-200',
};

export const COLLECTION_STATUS_STYLES = {
  PENDING: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  REMITTED:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
} as const;

/** Personnel affecté à l'événement : rôles, horaires, réponses, chevauchements. */
export function PersonnelCard({ order }: { order: Order }) {
  const t = useTranslations('assignments');
  const locale = useLocale();
  const can = usePermission();
  const describeError = useErrorMessage();
  const staffing = useOrderStaffing(order.id);
  const remove = useRemoveAssignment(order.id);
  const [editing, setEditing] = useState<Assignment | 'new' | null>(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const manage = can('staff.manage');
  const fail = (error: unknown) => toast.error(describeError(error));

  if (staffing.isPending) return <Skeleton className="h-48 w-full" />;
  const data = staffing.data;
  if (!data) return null;
  const info = data.serviceInfo;

  return (
    <Card data-testid="personnel-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserRoundCogIcon className="size-5 text-muted-foreground" aria-hidden />
          {t('title')}
          {data.alert && (
            <Badge variant="destructive" data-testid="staff-alert">
              {t(`alerts.${data.alert}`)}
            </Badge>
          )}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {can('orders.read') && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDocument(`/orders/${order.id}/preparation-sheet`).catch(fail)}
              >
                <ChefHatIcon aria-hidden />
                {t('preparationSheet')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDocument(`/orders/${order.id}/delivery-note`).catch(fail)}
              >
                <TruckIcon aria-hidden />
                {t('deliveryNote')}
              </Button>
            </>
          )}
          {manage && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <PlusIcon aria-hidden />
              {t('assign')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data.assignments.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border" data-testid="assignments-list">
            {data.assignments.map((assignment) => (
              <li key={assignment.id} className="flex flex-col gap-1 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium" dir="auto">
                    {assignment.member.firstName} {assignment.member.lastName}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t(`roles.${assignment.staffRole}`)}
                  </span>
                  <span className="text-sm tabular-nums" dir="ltr">
                    {formatMoment(assignment.start)} → {assignment.end.time}
                  </span>
                  <Badge variant="outline" className={ASSIGNMENT_STATUS_STYLES[assignment.status]}>
                    {t(`status.${assignment.status}`)}
                  </Badge>
                  <span className="ms-auto flex gap-1">
                    <Button asChild variant="ghost" size="icon" aria-label={t('call')}>
                      <a href={`tel:${assignment.member.phone}`}>
                        <PhoneIcon aria-hidden />
                      </a>
                    </Button>
                    {manage && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('edit')}
                          onClick={() => setEditing(assignment)}
                        >
                          <PencilIcon aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('remove')}
                          disabled={remove.isPending}
                          onClick={() =>
                            remove.mutate(assignment.id, {
                              onSuccess: () => toast.success(t('removed')),
                              onError: fail,
                            })
                          }
                        >
                          <TrashIcon aria-hidden />
                        </Button>
                      </>
                    )}
                  </span>
                </div>
                {assignment.declineReason && assignment.status === 'DECLINED' && (
                  <p className="text-sm text-destructive">
                    {t('declined', { reason: assignment.declineReason })}
                  </p>
                )}
                {assignment.cashToCollect !== null && assignment.cashMethod && (
                  <p
                    className="flex flex-wrap items-center gap-2 text-sm"
                    data-testid="assignment-cash"
                  >
                    <BanknoteIcon className="size-4 text-muted-foreground" aria-hidden />
                    {t('cash.toCollect', {
                      amount: formatMoney(assignment.cashToCollect, locale),
                      method: t(`cash.methods.${assignment.cashMethod}`),
                    })}
                    {assignment.cashDeclaration && (
                      <Badge
                        variant="outline"
                        className={COLLECTION_STATUS_STYLES[assignment.cashDeclaration.status]}
                      >
                        {t(`cash.status.${assignment.cashDeclaration.status}`, {
                          amount: formatMoney(assignment.cashDeclaration.amount, locale),
                        })}
                      </Badge>
                    )}
                  </p>
                )}
                {assignment.conflicts.length > 0 && (
                  <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-300">
                    <TriangleAlertIcon className="size-4" aria-hidden />
                    {t('overlaps', {
                      orders: assignment.conflicts.map((item) => item.orderReference).join(', '),
                    })}
                  </p>
                )}
                {assignment.notes && (
                  <p className="text-sm text-muted-foreground" dir="auto">
                    {assignment.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{t('serviceInfo.title')}</p>
            {can('orders.write') && (
              <Button size="sm" variant="ghost" onClick={() => setEditingInfo(true)}>
                <PencilIcon aria-hidden />
                {t('edit')}
              </Button>
            )}
          </div>
          <p>
            <span className="text-muted-foreground">{t('serviceInfo.contact')} : </span>
            {info.onSiteContactName || info.onSiteContactPhone ? (
              <>
                <span dir="auto">{info.onSiteContactName}</span>{' '}
                <span dir="ltr">{info.onSiteContactPhone}</span>
              </>
            ) : (
              t('serviceInfo.contactDefault')
            )}
          </p>
          {info.serviceNotes && (
            <p className="whitespace-pre-line">
              <span className="text-muted-foreground">{t('serviceInfo.serviceNotes')} : </span>
              {info.serviceNotes}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t('serviceInfo.hint')}</p>
        </div>
      </CardContent>

      {editing === 'new' && (
        <BatchAssignmentDialog order={order} onClose={() => setEditing(null)} />
      )}
      {editing && editing !== 'new' && (
        <AssignmentDialog order={order} assignment={editing} onClose={() => setEditing(null)} />
      )}
      {editingInfo && (
        <ServiceInfoDialog orderId={order.id} info={info} onClose={() => setEditingInfo(false)} />
      )}
    </Card>
  );
}

const assignmentFormSchema = z
  .object({
    membershipId: z.string().min(1),
    staffRole: z.enum(ASSIGNMENT_ROLES),
    startsAt: z.string(),
    endsAt: z.string(),
    notes: z.string(),
    collect: z.boolean(),
    cashAmount: z.string(),
    cashMethod: z.enum(COLLECTION_METHODS),
  })
  .refine((values) => values.endsAt > values.startsAt, {
    path: ['endsAt'],
    params: { i18n: 'endBeforeStart' },
  })
  .refine(
    (values) =>
      !values.collect ||
      !CASH_ROLES.includes(values.staffRole) ||
      amountToCents(values.cashAmount) > 0,
    { path: ['cashAmount'], params: { i18n: 'invalidAmount' } },
  );

/** Modification d'une affectation (la création passe par BatchAssignmentDialog). */
function AssignmentDialog({
  order,
  assignment,
  onClose,
}: {
  order: Order;
  assignment: Assignment;
  onClose: () => void;
}) {
  const t = useTranslations('assignments');
  const tr = useTranslations('staff.roles');
  const locale = useLocale();
  const describeError = useErrorMessage();
  const staff = useStaff({});
  const update = useUpdateAssignment(order.id);
  const [conflicts, setConflicts] = useState<AssignmentConflict[] | null>(null);
  const form = useZodForm(assignmentFormSchema, {
    membershipId: assignment.member.id,
    staffRole: assignment.staffRole,
    startsAt: `${assignment.start.date}T${assignment.start.time}`,
    endsAt: `${assignment.end.date}T${assignment.end.time}`,
    notes: assignment.notes ?? '',
    collect: assignment.cashToCollect !== null,
    cashAmount: assignment.cashToCollect ? centsToAmount(assignment.cashToCollect) : '',
    cashMethod: assignment.cashMethod ?? 'CASH',
  });
  const staffRole = form.watch('staffRole');
  const collect = form.watch('collect');
  const canCollect = CASH_ROLES.includes(staffRole);
  // Encaissement déjà déclaré par le livreur : montant figé
  const cashLocked =
    assignment.cashDeclaration !== null && assignment.cashDeclaration.status !== 'REJECTED';
  const members = (staff.data ?? []).filter((member) => member.status !== 'SUSPENDED');

  const save = async (values: z.output<typeof assignmentFormSchema>, force: boolean) => {
    const cash = values.collect && CASH_ROLES.includes(values.staffRole);
    const input = {
      staffRole: values.staffRole,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      notes: values.notes.trim() === '' ? null : values.notes.trim(),
      force,
      cashToCollect: cash ? amountToCents(values.cashAmount) : null,
      cashMethod: cash ? values.cashMethod : null,
    };
    try {
      await update.mutateAsync({ id: assignment.id, input });
      toast.success(t('saved'));
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === 'ASSIGNMENT_CONFLICT') {
        const parsed = z.array(assignmentConflictSchema).safeParse(error.details.conflicts);
        setConflicts(parsed.success ? parsed.data : []);
        return;
      }
      toast.error(describeError(error));
    }
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('dialog.editTitle')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={form.handleSubmit((values) => save(values, false))}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="membershipId"
          label={t('dialog.member')}
          render={(field, { invalid }) => (
            <Select value={field.value} onValueChange={field.onChange} disabled>
              <SelectTrigger id={field.id} className="w-full" aria-invalid={invalid}>
                <SelectValue placeholder={t('dialog.memberPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.firstName} {member.lastName} — {tr(`${member.role}.label`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name="staffRole"
          label={t('dialog.role')}
          render={(field) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNMENT_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`roles.${role}`)}
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
          name="startsAt"
          label={t('dialog.start')}
          render={(field, { invalid }) => (
            <Input {...field} type="datetime-local" dir="ltr" aria-invalid={invalid} />
          )}
        />
        <FormField
          control={form.control}
          name="endsAt"
          label={t('dialog.end')}
          render={(field, { invalid }) => (
            <Input {...field} type="datetime-local" dir="ltr" aria-invalid={invalid} />
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="notes"
        label={t('dialog.notes')}
        description={t('dialog.notesHint')}
        render={(field, { invalid }) => (
          <Textarea {...field} rows={2} dir="auto" aria-invalid={invalid} />
        )}
      />
      {canCollect && (
        <div className="flex flex-col gap-3 rounded-lg border p-3" data-testid="cash-fields">
          <div className="flex items-start gap-3">
            <Switch
              id="assignment-collect"
              checked={collect}
              disabled={cashLocked}
              onCheckedChange={(checked) => {
                form.setValue('collect', checked, { shouldDirty: true });
                // Proposé : le reste à payer de la commande
                if (checked && form.getValues('cashAmount') === '' && order.remaining > 0) {
                  form.setValue('cashAmount', centsToAmount(order.remaining));
                }
              }}
            />
            <label htmlFor="assignment-collect" className="flex flex-col gap-0.5 text-sm">
              <span className="font-medium">{t('cash.label')}</span>
              <span className="text-muted-foreground">
                {cashLocked ? t('cash.locked') : t('cash.hint')}
              </span>
            </label>
          </div>
          {collect && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="cashAmount"
                label={t('cash.amount')}
                render={(field, { invalid }) => (
                  <InputGroup>
                    <InputGroupInput
                      {...field}
                      inputMode="decimal"
                      dir="ltr"
                      disabled={cashLocked}
                      aria-invalid={invalid}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{currencyLabel(locale)}</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                )}
              />
              <FormField
                control={form.control}
                name="cashMethod"
                label={t('cash.method')}
                render={(field) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={cashLocked}>
                    <SelectTrigger id={field.id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLLECTION_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {t(`cash.methods.${method}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}
        </div>
      )}
      {conflicts && (
        <div
          className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          role="alert"
          data-testid="assignment-conflict"
        >
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlertIcon className="size-4" aria-hidden />
            {t('conflict.title')}
          </p>
          <ul className="text-sm">
            {conflicts.map((conflict) => (
              <li
                key={conflict.assignmentId}
                dir="ltr"
                className={cn(locale === 'ar' && 'text-end')}
              >
                {conflict.orderReference} — {formatMoment(conflict.start)} → {conflict.end.time}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => void form.handleSubmit((values) => save(values, true))()}
          >
            {t('conflict.force')}
          </Button>
        </div>
      )}
    </FormDialog>
  );
}

const serviceFormSchema = z
  .object({
    onSiteContactName: z.string(),
    onSiteContactPhone: z.string(),
    serviceNotes: z.string(),
  })
  .transform((values): z.input<typeof serviceInfoSchema> => ({
    onSiteContactName: values.onSiteContactName.trim() || null,
    onSiteContactPhone: values.onSiteContactPhone.trim() || null,
    serviceNotes: values.serviceNotes.trim() || null,
  }))
  .pipe(serviceInfoSchema);

function ServiceInfoDialog({
  orderId,
  info,
  onClose,
}: {
  orderId: string;
  info: z.input<typeof serviceInfoSchema>;
  onClose: () => void;
}) {
  const t = useTranslations('assignments.serviceInfo');
  const describeError = useErrorMessage();
  const update = useUpdateServiceInfo(orderId);
  const form = useZodForm(serviceFormSchema, {
    onSiteContactName: info.onSiteContactName ?? '',
    onSiteContactPhone: info.onSiteContactPhone ?? '',
    serviceNotes: info.serviceNotes ?? '',
  });
  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await update.mutateAsync(input);
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
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="onSiteContactName"
          label={t('contactName')}
          description={t('contactDefault')}
          render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
        />
        <FormField
          control={form.control}
          name="onSiteContactPhone"
          label={t('contactPhone')}
          render={(field, { invalid }) => <PhoneInput {...field} aria-invalid={invalid} />}
        />
      </div>
      <FormField
        control={form.control}
        name="serviceNotes"
        label={t('serviceNotes')}
        render={(field, { invalid }) => (
          <Textarea {...field} rows={3} dir="auto" aria-invalid={invalid} />
        )}
      />
    </FormDialog>
  );
}
