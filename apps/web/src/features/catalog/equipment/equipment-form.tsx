'use client';

import type { CatalogList, CatalogSettings, Equipment } from '@traiteur/shared';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { type Control, Controller, type FieldValues, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { FormField } from '@/components/forms/form-field';
import { UnsavedChangesGuard } from '@/components/forms/unsaved-changes-guard';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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
import { useErrorMessage } from '@/lib/api/use-error-message';
import { currencyLabel } from '@/lib/format/money';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useCatalogList, useSaveEquipment } from '../catalog-api';
import { FormActions, FormHeader, FormSection } from '../components/form-layout';
import { ImageUploadField } from '../forms/image-upload-field';
import { LocalizedTextFields } from '../forms/localized-text-fields';
import { PriceFields } from '../forms/price-fields';
import { useLocalized } from '../use-localized';
import {
  EMPTY_EQUIPMENT_FORM,
  equipmentFormSchema,
  type EquipmentFormValues,
  equipmentToFormValues,
} from './equipment-form-schema';

const LIST_PATH = '/admin/catalog/equipment';
const NONE = 'none';

/** Choix dans une liste du catalogue (catégorie, gamme) ; l'élément déjà porté reste proposé. */
function ListSelect({
  control,
  name,
  list,
  label,
  noneLabel,
  kept,
}: {
  control: Control<EquipmentFormValues, unknown, FieldValues>;
  name: 'categoryId' | 'rangeId';
  list: CatalogList;
  label: string;
  noneLabel: string;
  kept: string | undefined;
}) {
  const localized = useLocalized();
  const items = useCatalogList(list);
  const options = (items.data ?? []).filter(
    (item) => (item.isActive && !item.archived) || item.id === kept,
  );
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      render={(field) => (
        <Select
          value={field.value === '' ? NONE : field.value}
          onValueChange={(value) => field.onChange(value === NONE ? '' : value)}
        >
          <SelectTrigger id={field.id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{noneLabel}</SelectItem>
            {options.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {localized(item.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}

interface EquipmentFormProps {
  settings: CatalogSettings;
  item?: Equipment;
}

export function EquipmentForm({ settings, item }: EquipmentFormProps) {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const router = useRouter();
  const describeError = useErrorMessage();
  const save = useSaveEquipment();
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const ttc = settings.priceEntryMode === 'TTC';

  const form = useZodForm(
    equipmentFormSchema,
    item ? equipmentToFormValues(item, settings) : EMPTY_EQUIPMENT_FORM,
  );
  const [price, taxRate, nameFr] = useWatch({
    control: form.control,
    name: ['price', 'taxRateBps', 'name.fr'],
  });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: item?.id ?? null, input });
      setSaved(true);
      toast.success(t(item ? 'equipment.saved' : 'equipment.created'));
      router.push(LIST_PATH);
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <UnsavedChangesGuard when={form.formState.isDirty && !saved} />
      <FormHeader
        title={t(item ? 'equipment.editTitle' : 'equipment.newTitle')}
        backHref={LIST_PATH}
      />

      <FormSection title={t('equipment.sectionGeneral')}>
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
        <div className="grid gap-4 md:grid-cols-2">
          <ListSelect
            control={form.control}
            name="categoryId"
            list="equipment-categories"
            label={t('fields.category')}
            noneLabel={t('fields.noCategory')}
            kept={item?.category?.id}
          />
          <ListSelect
            control={form.control}
            name="rangeId"
            list="ranges"
            label={t('packages.range')}
            noneLabel={t('packages.noRange')}
            kept={item?.range?.id}
          />
        </div>
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
      </FormSection>

      <FormSection title={t('equipment.sectionPrice')}>
        <PriceFields
          control={form.control}
          settings={settings}
          priceName="price"
          taxRateName="taxRateBps"
          priceValue={price}
          taxRateValue={taxRate}
        />
        <FormField
          control={form.control}
          name="replacementPrice"
          label={t(ttc ? 'equipment.replacementPriceTtc' : 'equipment.replacementPriceHt')}
          description={t('equipment.replacementPriceHint')}
          render={(field, { invalid }) => (
            <InputGroup className="md:w-80">
              <InputGroupInput {...field} inputMode="decimal" dir="ltr" aria-invalid={invalid} />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{currencyLabel(locale)}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          )}
        />
      </FormSection>

      <FormSection title={t('equipment.sectionStock')}>
        <FormField
          control={form.control}
          name="stockQuantity"
          label={t('equipment.stockQuantity')}
          description={t('equipment.stockHint')}
          render={(field, { invalid }) => (
            <Input
              {...field}
              className="md:w-48"
              inputMode="numeric"
              dir="ltr"
              aria-invalid={invalid}
            />
          )}
        />
        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="isActive" checked={field.value} onCheckedChange={field.onChange} />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="isActive" className="text-base">
                  {t('equipment.active')}
                </FieldLabel>
                <FieldDescription>{t('equipment.activeHint')}</FieldDescription>
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
