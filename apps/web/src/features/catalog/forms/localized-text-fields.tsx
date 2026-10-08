'use client';

import type { Control, ControllerRenderProps, FieldPath, FieldValues } from 'react-hook-form';

import { FormField } from '@/components/forms/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface LocalizedTextFieldsProps<TValues extends FieldValues> {
  control: Control<TValues, unknown, FieldValues>;
  /** Champ du formulaire contenant { fr, ar } (ex. « name »). */
  name: string;
  labelFr: string;
  labelAr: string;
  description?: string;
  multiline?: boolean;
}

type TextFieldProps<TValues extends FieldValues> = ControllerRenderProps<
  TValues,
  FieldPath<TValues>
> & { id: string };

function TextControl<TValues extends FieldValues>({
  field,
  language,
  invalid,
  multiline,
}: {
  field: TextFieldProps<TValues>;
  language: 'fr' | 'ar';
  invalid: boolean;
  multiline: boolean;
}) {
  // Props du champ (dont la ref, pour le focus sur erreur) transmises telles quelles
  const props = {
    ...field,
    value: String(field.value ?? ''),
    lang: language,
    dir: language === 'ar' ? 'rtl' : 'ltr',
    'aria-invalid': invalid,
  } as const;
  return multiline ? <Textarea {...props} rows={3} /> : <Input {...props} />;
}

/**
 * Texte bilingue : français (obligatoire pour un nom) et arabe (facultatif), côte à côte sur
 * grand écran, l'un sous l'autre sur téléphone. Le champ arabe s'écrit toujours de droite à
 * gauche, même dans l'interface en français.
 */
export function LocalizedTextFields<TValues extends FieldValues>({
  control,
  name,
  labelFr,
  labelAr,
  description,
  multiline = false,
}: LocalizedTextFieldsProps<TValues>) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        control={control}
        name={`${name}.fr` as FieldPath<TValues>}
        label={labelFr}
        description={description}
        render={(field, { invalid }) => (
          <TextControl field={field} language="fr" invalid={invalid} multiline={multiline} />
        )}
      />
      <FormField
        control={control}
        name={`${name}.ar` as FieldPath<TValues>}
        label={labelAr}
        render={(field, { invalid }) => (
          <TextControl field={field} language="ar" invalid={invalid} multiline={multiline} />
        )}
      />
    </div>
  );
}
