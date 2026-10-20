'use client';

import {
  type CatalogList,
  type CatalogListItem,
  catalogListItemInputSchema,
} from '@traiteur/shared';
import { useTranslations } from 'next-intl';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormDialog } from '@/components/forms/form-dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useSaveCatalogListItem } from '../catalog-api';
import {
  EMPTY_LOCALIZED,
  fromLocalizedText,
  localizedFormSchema,
  toLocalizedText,
  toOptionalLocalizedText,
} from '../forms/form-values';
import { LocalizedTextFields } from '../forms/localized-text-fields';

const listItemFormSchema = z
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
  .pipe(catalogListItemInputSchema);

/** Ajout ou modification d'un élément d'une liste (item absent : ajout). */
export function CatalogListFormDialog({
  list,
  item,
  onClose,
}: {
  list: CatalogList;
  item?: CatalogListItem;
  onClose: () => void;
}) {
  const t = useTranslations('catalog');
  const describeError = useErrorMessage();
  const save = useSaveCatalogListItem(list);
  const form = useZodForm(
    listItemFormSchema,
    item
      ? {
          name: fromLocalizedText(item.name),
          description: fromLocalizedText(item.description),
          isActive: item.isActive,
        }
      : { name: EMPTY_LOCALIZED, description: EMPTY_LOCALIZED, isActive: true },
  );

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: item?.id ?? null, input });
      toast.success(t('lists.saved'));
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={`${t(`lists.sections.${list}.title`)} — ${t(item ? 'lists.editTitle' : 'lists.newTitle')}`}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      {item && (
        <p className="-mt-2 text-sm text-muted-foreground">
          {t('lists.code', { code: item.code })}
        </p>
      )}
      <LocalizedTextFields
        control={form.control}
        name="name"
        labelFr={t('fields.nameFr')}
        labelAr={t('fields.nameAr')}
      />
      {list === 'ranges' && (
        <LocalizedTextFields
          control={form.control}
          name="description"
          labelFr={t('fields.descriptionFr')}
          labelAr={t('fields.descriptionAr')}
          multiline
        />
      )}
      <Controller
        control={form.control}
        name="isActive"
        render={({ field }) => (
          <Field orientation="horizontal">
            <Switch id={`${list}-active`} checked={field.value} onCheckedChange={field.onChange} />
            <FieldLabel htmlFor={`${list}-active`} className="text-base">
              {t('lists.active')}
            </FieldLabel>
          </Field>
        )}
      />
    </FormDialog>
  );
}
