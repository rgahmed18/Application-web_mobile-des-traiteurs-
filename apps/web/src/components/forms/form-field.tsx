'use client';

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

/** Champ de formulaire : libellé, contrôle, aide et erreur traduite, reliés pour l'accessibilité. */
export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  control,
  name,
  label,
  description,
  render,
}: FormFieldProps<TValues, TName>) {
  const id = `field-${name.replace(/\./g, '-')}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {render({ ...field, id }, { ...fieldState, invalid: fieldState.invalid })}
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}
