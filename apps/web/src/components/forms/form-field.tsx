'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  type Control,
  Controller,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';

import { useRestoredFields } from './restored-fields';

interface FormFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues, unknown, FieldValues>;
  name: TName;
  label: ReactNode;
  description?: ReactNode;
  /** Rend le contrôle de saisie ; `invalid` sert à l'attribut aria-invalid. */
  render: (
    field: ControllerRenderProps<TValues, TName> & { id: string },
    state: ControllerFieldState & { invalid: boolean },
  ) => ReactNode;
}

/**
 * Champ de formulaire : libellé, contrôle, aide et erreur traduite, reliés pour l'accessibilité.
 * Brouillon repris : la valeur qui en vient est marquée « Repris » tant que le champ n'a pas été
 * consulté (focus puis sortie).
 */
export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  control,
  name,
  label,
  description,
  render,
}: FormFieldProps<TValues, TName>) {
  const t = useTranslations('drafts');
  const restored = useRestoredFields();
  const id = `field-${name.replace(/\./g, '-')}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const fromDraft = restored && fieldState.isDirty && !fieldState.isTouched;
        return (
          <Field
            data-invalid={fieldState.invalid}
            data-restored={fromDraft || undefined}
            className={
              fromDraft ? 'rounded-md outline-2 outline-offset-4 outline-sky-400/70' : undefined
            }
          >
            <FieldLabel htmlFor={id}>
              {label}
              {fromDraft && (
                <span
                  data-testid="restored-field"
                  className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-900 dark:text-sky-100"
                >
                  {t('restoredField')}
                </span>
              )}
            </FieldLabel>
            {render({ ...field, id }, { ...fieldState, invalid: fieldState.invalid })}
            {description && <FieldDescription>{description}</FieldDescription>}
            {fieldState.error && <FieldError errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
}
