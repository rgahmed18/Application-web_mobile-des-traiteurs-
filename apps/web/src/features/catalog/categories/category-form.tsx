'use client';

import { type Category, categoryInputSchema } from '@traiteur/shared';
import { useTranslations } from 'next-intl';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useSaveCategory } from '../catalog-api';
import { FormDialog } from '@/components/forms/form-dialog';
import {
  EMPTY_LOCALIZED,
  fromLocalizedText,
  localizedFormSchema,
  toLocalizedText,
  toOptionalLocalizedText,
} from '../forms/form-values';
import { LocalizedTextFields } from '../forms/localized-text-fields';

export const categoryFormSchema = z
  .object({
    name: localizedFormSchema,
    description: localizedFormSchema,
    isActive: z.boolean(),
  })
  .transform((values) => ({
    name: toLocalizedText(values.name),
    description: toOptionalLocalizedText(values.description),
    isActive: values.isActive,
  }))
  .pipe(categoryInputSchema);

/** Création ou modification d'une catégorie (category absente : création). */
export function CategoryFormDialog({
  category,
  onClose,
}: {
  category?: Category;
  onClose: () => void;
}) {
  const t = useTranslations('catalog');
  const describeError = useErrorMessage();
  const save = useSaveCategory();
  const form = useZodForm(
    categoryFormSchema,
    category
      ? {
          name: fromLocalizedText(category.name),
          description: fromLocalizedText(category.description),
          isActive: category.isActive,
        }
      : { name: EMPTY_LOCALIZED, description: EMPTY_LOCALIZED, isActive: true },
  );

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: category?.id ?? null, input });
      toast.success(t('categories.saved'));
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t(category ? 'categories.editTitle' : 'categories.newTitle')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <LocalizedTextFields
        control={form.control}
        name="name"
        labelFr={t('fields.nameFr')}
        labelAr={t('fields.nameAr')}
      />
      <LocalizedTextFields
        control={form.control}
        name="description"
        labelFr={t('fields.descriptionFr')}
        labelAr={t('fields.descriptionAr')}
        multiline
      />
      <Controller
        control={form.control}
        name="isActive"
        render={({ field }) => (
          <Field orientation="horizontal">
            <Switch id="category-active" checked={field.value} onCheckedChange={field.onChange} />
            <FieldLabel htmlFor="category-active" className="text-base">
              {t('categories.active')}
            </FieldLabel>
          </Field>
        )}
      />
    </FormDialog>
  );
}
