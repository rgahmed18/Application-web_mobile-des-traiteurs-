'use client';

import type { CatalogSettings, Package } from '@traiteur/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { FormField } from '@/components/forms/form-field';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useSavePackage } from '../catalog-api';
import { FormActions, FormHeader, FormSection } from '../components/form-layout';
import { ImageUploadField } from '../forms/image-upload-field';
import { LocalizedTextFields } from '../forms/localized-text-fields';
import { PriceFields } from '../forms/price-fields';
import { UnsavedChangesGuard } from '../forms/unsaved-changes-guard';
import {
  CompositionEditor,
  CompositionValue,
  type DishSummary,
  summariesFromPackage,
} from './composition-editor';
import { EMPTY_PACKAGE_FORM, packageFormSchema, packageToFormValues } from './package-form-schema';

const LIST_PATH = '/admin/catalog/packages';

interface PackageFormProps {
  settings: CatalogSettings;
  pkg?: Package;
  mode: 'create' | 'edit' | 'duplicate';
}

export function PackageForm({ settings, pkg, mode }: PackageFormProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const router = useRouter();
  const describeError = useErrorMessage();
  const save = useSavePackage();
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [summaries, setSummaries] = useState(() => summariesFromPackage(pkg));

  const form = useZodForm(
    packageFormSchema,
    pkg
      ? packageToFormValues(pkg, settings, mode === 'duplicate' ? tc('copySuffix') : undefined)
      : EMPTY_PACKAGE_FORM,
  );
  const [price, taxRate, nameFr] = useWatch({
    control: form.control,
    name: ['pricePerPerson', 'taxRateBps', 'name.fr'],
  });

  const addSummary = (summary: DishSummary) =>
    setSummaries((current) => new Map(current).set(summary.id, summary));

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: mode === 'edit' && pkg ? pkg.id : null, input });
      setSaved(true);
      toast.success(t(mode === 'edit' ? 'packages.saved' : 'packages.created'));
      router.push(LIST_PATH);
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <UnsavedChangesGuard when={form.formState.isDirty && !saved} />
      <FormHeader
        title={t(mode === 'edit' ? 'packages.editTitle' : 'packages.newTitle')}
        backHref={LIST_PATH}
      />

      <FormSection title={t('packages.sectionGeneral')}>
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

      <FormSection title={t('packages.composition')}>
        <CompositionEditor
          control={form.control}
          settings={settings}
          summaries={summaries}
          onSummary={addSummary}
        />
      </FormSection>

      <FormSection title={t('packages.sectionPrice')}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
          <PriceFields
            control={form.control}
            settings={settings}
            priceName="pricePerPerson"
            taxRateName="taxRateBps"
            priceValue={price}
            taxRateValue={taxRate}
            perPerson
          />
          <CompositionValue control={form.control} settings={settings} summaries={summaries} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="minGuests"
            label={`${t('packages.guests')} — ${t('packages.minGuests')}`}
            render={(field, { invalid }) => (
              <Input {...field} inputMode="numeric" dir="ltr" aria-invalid={invalid} />
            )}
          />
          <FormField
            control={form.control}
            name="maxGuests"
            label={`${t('packages.guests')} — ${t('packages.maxGuests')}`}
            description={t('packages.maxGuestsHint')}
            render={(field, { invalid }) => (
              <Input {...field} inputMode="numeric" dir="ltr" aria-invalid={invalid} />
            )}
          />
        </div>
        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="isActive" checked={field.value} onCheckedChange={field.onChange} />
              <FieldLabel htmlFor="isActive" className="text-base">
                {t('packages.active')}
              </FieldLabel>
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
