'use client';

import { ALLERGENS, type CatalogSettings, type Dish, DISH_UNITS } from '@traiteur/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { FormField } from '@/components/forms/form-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useCategories, useSaveDish } from '../catalog-api';
import { FormActions, FormHeader, FormSection } from '../components/form-layout';
import { ImageUploadField } from '../forms/image-upload-field';
import { LocalizedTextFields } from '../forms/localized-text-fields';
import { PriceFields } from '../forms/price-fields';
import { UnsavedChangesGuard } from '../forms/unsaved-changes-guard';
import { useLocalized } from '../use-localized';
import { dishFormSchema, dishToFormValues, EMPTY_DISH_FORM } from './dish-form-schema';

const LIST_PATH = '/admin/catalog/dishes';
const NO_CATEGORY = 'none';

interface DishFormProps {
  settings: CatalogSettings;
  /** Plat modifié (édition) ou modèle (duplication). */
  dish?: Dish;
  mode: 'create' | 'edit' | 'duplicate';
}

export function DishForm({ settings, dish, mode }: DishFormProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const router = useRouter();
  const describeError = useErrorMessage();
  const localized = useLocalized();
  const categories = useCategories();
  const save = useSaveDish();
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);

  const form = useZodForm(
    dishFormSchema,
    dish
      ? dishToFormValues(dish, settings, mode === 'duplicate' ? tc('copySuffix') : undefined)
      : EMPTY_DISH_FORM,
  );
  const [price, taxRate, nameFr] = useWatch({
    control: form.control,
    name: ['price', 'taxRateBps', 'name.fr'],
  });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: mode === 'edit' && dish ? dish.id : null, input });
      setSaved(true);
      toast.success(t(mode === 'edit' ? 'dishes.saved' : 'dishes.created'));
      router.push(LIST_PATH);
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <UnsavedChangesGuard when={form.formState.isDirty && !saved} />
      <FormHeader
        title={t(mode === 'edit' ? 'dishes.editTitle' : 'dishes.newTitle')}
        backHref={LIST_PATH}
      />

      <FormSection title={t('dishes.sectionGeneral')}>
        <LocalizedTextFields
          control={form.control}
          name="name"
          labelFr={t('fields.nameFr')}
          labelAr={t('fields.nameAr')}
          description={t('fields.nameHint')}
        />
        <LocalizedTextFields
          control={form.control}
          name="description"
          labelFr={t('fields.descriptionFr')}
          labelAr={t('fields.descriptionAr')}
          multiline
        />
        <FormField
          control={form.control}
          name="categoryId"
          label={t('fields.category')}
          render={(field) => (
            <Select
              value={field.value === '' ? NO_CATEGORY : field.value}
              onValueChange={(value) => field.onChange(value === NO_CATEGORY ? '' : value)}
            >
              <SelectTrigger id={field.id} className="w-full md:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>{t('fields.noCategory')}</SelectItem>
                {(categories.data ?? []).map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {localized(category.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormSection>

      <FormSection title={t('dishes.sectionPrice')}>
        <PriceFields
          control={form.control}
          settings={settings}
          priceName="price"
          taxRateName="taxRateBps"
          priceValue={price}
          taxRateValue={taxRate}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="unit"
            label={t('dishes.unit')}
            render={(field) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={field.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISH_UNITS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {t(`units.${unit}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FormField
            control={form.control}
            name="minQuantity"
            label={t('dishes.minQuantity')}
            description={t('dishes.minQuantityHint')}
            render={(field, { invalid }) => (
              <Input {...field} inputMode="numeric" dir="ltr" aria-invalid={invalid} />
            )}
          />
        </div>
      </FormSection>

      <FormSection title={t('dishes.sectionDetails')}>
        <Controller
          control={form.control}
          name="imageKey"
          render={({ field }) => (
            <ImageUploadField
              value={field.value}
              onChange={field.onChange}
              onBusyChange={setUploading}
              alt={t('photo.alt', { name: nameFr || '…' })}
            />
          )}
        />
        <Controller
          control={form.control}
          name="allergens"
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">{t('dishes.allergens')}</FieldLegend>
              <FieldDescription>{t('dishes.allergensHint')}</FieldDescription>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ALLERGENS.map((allergen) => {
                  const id = `allergen-${allergen}`;
                  const checked = field.value.includes(allergen);
                  return (
                    <Field key={allergen} orientation="horizontal">
                      <Checkbox
                        id={id}
                        className="size-6"
                        checked={checked}
                        onCheckedChange={(value) =>
                          field.onChange(
                            value === true
                              ? [...field.value, allergen]
                              : field.value.filter((item) => item !== allergen),
                          )
                        }
                      />
                      <FieldLabel htmlFor={id} className="text-base font-normal">
                        {t(`allergens.${allergen}`)}
                      </FieldLabel>
                    </Field>
                  );
                })}
              </div>
            </FieldSet>
          )}
        />
        <Controller
          control={form.control}
          name="isAvailable"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="isAvailable" checked={field.value} onCheckedChange={field.onChange} />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="isAvailable" className="text-base">
                  {t('dishes.availability')}
                </FieldLabel>
                <FieldDescription>{t('dishes.availabilityHint')}</FieldDescription>
              </div>
            </Field>
          )}
        />
      </FormSection>

      <FormActions
        cancelHref={LIST_PATH}
        submitting={form.formState.isSubmitting}
        disabled={uploading}
      />
    </form>
  );
}
