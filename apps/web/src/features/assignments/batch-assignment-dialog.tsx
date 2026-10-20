'use client';

import {
  ASSIGNMENT_ROLES,
  assignmentBatchConflictSchema,
  type AssignmentLineProblem,
  type AssignmentRole,
  COLLECTION_METHODS,
  MAX_ASSIGNMENT_BATCH,
  type Order,
} from '@traiteur/shared';
import { CopyIcon, PlusIcon, TrashIcon, TriangleAlertIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFieldArray, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormDialog } from '@/components/forms/form-dialog';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { amountToCents, centsToAmount } from '@/features/catalog/forms/form-values';
import { useStaff } from '@/features/staff/staff-api';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { currencyLabel } from '@/lib/format/money';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { CASH_ROLES, defaultTimes, formatMoment } from './assignment-times';
import { useCreateAssignments } from './assignments-api';

const lineSchema = z
  .object({
    membershipId: z.string().min(1),
    staffRole: z.enum(ASSIGNMENT_ROLES),
    startsAt: z.string(),
    endsAt: z.string(),
    notes: z.string(),
    collect: z.boolean(),
    cashAmount: z.string(),
    cashMethod: z.enum(COLLECTION_METHODS),
    /** Passer outre un chevauchement signalé sur cette ligne. */
    force: z.boolean(),
  })
  .refine((line) => line.endsAt > line.startsAt, {
    path: ['endsAt'],
    params: { i18n: 'endBeforeStart' },
  })
  .refine(
    (line) =>
      !line.collect || !CASH_ROLES.includes(line.staffRole) || amountToCents(line.cashAmount) > 0,
    { path: ['cashAmount'], params: { i18n: 'invalidAmount' } },
  );

const batchFormSchema = z
  .object({ lines: z.array(lineSchema).min(1).max(MAX_ASSIGNMENT_BATCH) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      if (line.membershipId === '') return;
      const key = `${line.membershipId}:${line.staffRole}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'staffRole'],
          params: { i18n: 'duplicateAssignment' },
        });
      }
      seen.add(key);
    });
  });
type BatchForm = z.input<typeof batchFormSchema>;

/**
 * Affectation de plusieurs membres en une opération : une ligne par membre et par rôle,
 * horaires pré-remplis depuis l'événement selon le rôle et modifiables, copie des horaires
 * d'une ligne sur toutes. Enregistrement en une transaction ; chaque ligne en difficulté est
 * signalée (chevauchement levé ligne par ligne, autres problèmes à corriger).
 */
export function BatchAssignmentDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const t = useTranslations('assignments');
  const tr = useTranslations('staff.roles');
  const locale = useLocale();
  const describeError = useErrorMessage();
  const staff = useStaff({});
  const create = useCreateAssignments(order.id);
  /** Problèmes renvoyés par l'API, rattachés à l'identifiant stable de chaque ligne. */
  const [problems, setProblems] = useState<Map<string, AssignmentLineProblem>>(new Map());

  const newLine = (role: AssignmentRole = 'WAITER'): BatchForm['lines'][number] => ({
    membershipId: '',
    staffRole: role,
    ...defaultTimes(order, role),
    notes: '',
    collect: false,
    cashAmount: '',
    cashMethod: 'CASH',
    force: false,
  });
  const form = useZodForm(batchFormSchema, { lines: [newLine()] });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const lines = useWatch({ control: form.control, name: 'lines' });
  const members = (staff.data ?? []).filter((member) => member.status !== 'SUSPENDED');

  const copyTimes = (from: number) => {
    const source = form.getValues(`lines.${from}`);
    fields.forEach((_field, index) => {
      form.setValue(`lines.${index}.startsAt`, source.startsAt, { shouldDirty: true });
      form.setValue(`lines.${index}.endsAt`, source.endsAt, { shouldDirty: true });
    });
    toast.success(t('batch.copied'));
  };

  const save = async (values: z.output<typeof batchFormSchema>) => {
    const ids = fields.map((field) => field.id);
    try {
      await create.mutateAsync({
        lines: values.lines.map((line) => {
          const cash = line.collect && CASH_ROLES.includes(line.staffRole);
          return {
            membershipId: line.membershipId,
            staffRole: line.staffRole,
            startsAt: line.startsAt,
            endsAt: line.endsAt,
            notes: line.notes.trim() === '' ? null : line.notes.trim(),
            force: line.force,
            cashToCollect: cash ? amountToCents(line.cashAmount) : null,
            cashMethod: cash ? line.cashMethod : null,
          };
        }),
      });
      toast.success(t('batch.saved', { count: values.lines.length }));
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === 'ASSIGNMENT_BATCH_CONFLICT') {
        const parsed = assignmentBatchConflictSchema.safeParse(error.details);
        const next = new Map<string, AssignmentLineProblem>();
        for (const problem of parsed.success ? parsed.data.problems : []) {
          const id = ids[problem.index];
          if (id) next.set(id, problem);
        }
        setProblems(next);
        return;
      }
      toast.error(describeError(error));
    }
  };

  return (
    <FormDialog
      open
      wide
      onClose={onClose}
      title={t('batch.title')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={form.handleSubmit(save)}
    >
      <p className="-mt-2 text-sm text-muted-foreground">{t('batch.hint')}</p>
      {problems.size > 0 && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          {t('batch.problemsTitle')}
        </p>
      )}
      <ol className="flex flex-col gap-3" data-testid="assignment-lines">
        {fields.map((field, index) => {
          const line = lines[index] ?? field;
          const problem = problems.get(field.id);
          const canCollect = CASH_ROLES.includes(line.staffRole);
          const number = index + 1;
          return (
            <li
              key={field.id}
              className="flex flex-col gap-3 rounded-xl border p-3"
              data-testid="assignment-line"
              aria-label={t('batch.line', { number })}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{t('batch.line', { number })}</p>
                <div className="flex gap-1">
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => copyTimes(index)}
                    >
                      <CopyIcon aria-hidden />
                      {t('batch.copyTimes')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('batch.removeLine', { number })}
                    disabled={fields.length === 1}
                    onClick={() => remove(index)}
                  >
                    <TrashIcon aria-hidden />
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FormField
                  control={form.control}
                  name={`lines.${index}.membershipId`}
                  label={t('dialog.member')}
                  render={(input, { invalid }) => (
                    <Select value={input.value} onValueChange={input.onChange}>
                      <SelectTrigger id={input.id} className="w-full" aria-invalid={invalid}>
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
                  name={`lines.${index}.staffRole`}
                  label={t('dialog.role')}
                  render={(input, { invalid }) => (
                    <Select
                      value={input.value}
                      onValueChange={(value) => {
                        input.onChange(value);
                        // Horaires proposés pour le rôle, tant qu'ils n'ont pas été modifiés
                        if (!form.getFieldState(`lines.${index}.startsAt`).isDirty) {
                          const times = defaultTimes(order, value as AssignmentRole);
                          form.setValue(`lines.${index}.startsAt`, times.startsAt);
                          form.setValue(`lines.${index}.endsAt`, times.endsAt);
                        }
                      }}
                    >
                      <SelectTrigger id={input.id} className="w-full" aria-invalid={invalid}>
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
                <FormField
                  control={form.control}
                  name={`lines.${index}.startsAt`}
                  label={t('dialog.start')}
                  render={(input, { invalid }) => (
                    <Input {...input} type="datetime-local" dir="ltr" aria-invalid={invalid} />
                  )}
                />
                <FormField
                  control={form.control}
                  name={`lines.${index}.endsAt`}
                  label={t('dialog.end')}
                  render={(input, { invalid }) => (
                    <Input {...input} type="datetime-local" dir="ltr" aria-invalid={invalid} />
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name={`lines.${index}.notes`}
                label={t('dialog.notes')}
                render={(input, { invalid }) => (
                  <Textarea {...input} rows={1} dir="auto" aria-invalid={invalid} />
                )}
              />

              {canCollect && (
                <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
                  <div className="flex items-center gap-3">
                    <Switch
                      id={`line-${field.id}-collect`}
                      checked={line.collect}
                      onCheckedChange={(checked) => {
                        form.setValue(`lines.${index}.collect`, checked, { shouldDirty: true });
                        if (
                          checked &&
                          form.getValues(`lines.${index}.cashAmount`) === '' &&
                          order.remaining > 0
                        ) {
                          form.setValue(
                            `lines.${index}.cashAmount`,
                            centsToAmount(order.remaining),
                          );
                        }
                      }}
                    />
                    <label htmlFor={`line-${field.id}-collect`} className="text-sm font-medium">
                      {t('cash.label')}
                    </label>
                  </div>
                  {line.collect && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.cashAmount`}
                        label={t('cash.amount')}
                        render={(input, { invalid }) => (
                          <InputGroup>
                            <InputGroupInput
                              {...input}
                              inputMode="decimal"
                              dir="ltr"
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
                        name={`lines.${index}.cashMethod`}
                        label={t('cash.method')}
                        render={(input) => (
                          <Select value={input.value} onValueChange={input.onChange}>
                            <SelectTrigger id={input.id} className="w-full">
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

              {problem && (
                <div
                  role="alert"
                  data-testid="assignment-line-problem"
                  className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                >
                  <p className="flex items-center gap-2 font-medium">
                    <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                    {t(`batch.problems.${problem.code}`)}
                  </p>
                  {problem.code === 'OVERLAP' && (
                    <>
                      <ul>
                        {problem.conflicts.map((conflict) => (
                          <li key={conflict.assignmentId} dir="ltr" className="rtl:text-end">
                            {conflict.orderReference} — {formatMoment(conflict.start)} →{' '}
                            {conflict.end.time}
                          </li>
                        ))}
                        {problem.lines.length > 0 && (
                          <li>
                            {t('batch.otherLines', {
                              count: problem.lines.length,
                              lines: problem.lines.map((other) => other + 1).join(', '),
                            })}
                          </li>
                        )}
                      </ul>
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={line.force}
                          onCheckedChange={(checked) =>
                            form.setValue(`lines.${index}.force`, checked === true, {
                              shouldDirty: true,
                            })
                          }
                        />
                        {t('batch.force')}
                      </label>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={fields.length >= MAX_ASSIGNMENT_BATCH}
        onClick={() => append(newLine())}
      >
        <PlusIcon aria-hidden />
        {t('batch.addLine')}
      </Button>
    </FormDialog>
  );
}
