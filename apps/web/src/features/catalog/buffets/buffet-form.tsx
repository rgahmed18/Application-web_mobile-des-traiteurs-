'use client';

import type { Buffet, CatalogSettings } from '@traiteur/shared';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { FormField } from '@/components/forms/form-field';
import { UnsavedChangesGuard } from '@/components/forms/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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

import { useSaveBuffet } from '../catalog-api';
import { FormActions, FormHeader, FormSection } from '../components/form-layout';
import { CatalogListSelect } from '../forms/catalog-list-select';
import { ImageUploadField } from '../forms/image-upload-field';
import { LocalizedTextFields } from '../forms/localized-text-fields';
import { PriceFields } from '../forms/price-fields';
import {
  CompositionEditor,
  type DishSummary,
  summariesFromPackage,
} from '../packages/composition-editor';
import { buffetFormSchema, buffetToFormValues, EMPTY_BUFFET_FORM } from './buffet-form-schema';

const LIST_PATH = '/admin/catalog/buffets';

export function BuffetForm({ settings, buffet }: { settings: CatalogSettings; buffet?: Buffet }) {
  const t = useTranslations('catalog');
  const router = useRouter();
  const describeError = useErrorMessage();
  const save = useSaveBuffet();
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  // Même forme que la composition d'un menu : plats et quantités
  const [summaries, setSummaries] = useState(() => summariesFromPackage(buffet));

  const form = useZodForm(
    buffetFormSchema,
    buffet ? buffetToFormValues(buffet, settings) : EMPTY_BUFFET_FORM,
  );
  const [price, taxRate, nameFr, pricingUnit] = useWatch({
    control: form.control,
    name: ['price', 'taxRateBps', 'name.fr', 'pricingUnit'],
  });
  const freeItems = useFieldArray({ control: form.control, name: 'freeItems' });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: buffet?.id ?? null, input });
      setSaved(true);
      toast.success(t(buffet ? 'buffets.saved' : 'buffets.created'));
      router.push(LIST_PATH);
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <UnsavedChangesGuard when={form.formState.isDirty && !saved} />
      <FormHeader
        title={t(buffet ? 'buffets.editTitle' : 'buffets.newTitle')}
        backHref={LIST_PATH}
      />

      <FormSection title={t('buffets.sectionGeneral')}>
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
          <CatalogListSelect
            control={form.control}
            name="typeId"
            list="buffet-types"
            label={t('buffets.type')}
            noneLabel={t('buffets.noType')}
            kept={buffet?.type?.id}
          />
          <CatalogListSelect
            control={form.control}
            name="rangeId"
            list="ranges"
            label={t('packages.range')}
            noneLabel={t('packages.noRange')}
            kept={buffet?.range?.id}
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

      <FormSection title={t('buffets.composition')} description={t('buffets.compositionHint')}>
        <CompositionEditor
          control={form.control}
          settings={settings}
          summaries={summaries}
          onSummary={(summary: DishSummary) =>
            setSummaries((current) => new Map(current).set(summary.id, summary))
          }
        />
        <div className="flex flex-col gap-3" data-testid="free-items">
          <p className="font-medium">{t('buffets.freeItems')}</p>
          {freeItems.fields.map((field, index) => (
            <div key={field.id} className="flex flex-wrap items-end gap-3">
              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                <Input
                  {...form.register(`freeItems.${index}.fr`)}
                  aria-label={t('buffets.freeItemFr', { number: index + 1 })}
                  placeholder={t('buffets.freeItemPlaceholder')}
                  dir="auto"
                />
                <Input
                  {...form.register(`freeItems.${index}.ar`)}
                  aria-label={t('buffets.freeItemAr', { number: index + 1 })}
                  dir="rtl"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('buffets.removeFreeItem', { number: index + 1 })}
                onClick={() => freeItems.remove(index)}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => freeItems.append({ fr: '', ar: '' })}
          >
            <PlusIcon aria-hidden />
            {t('buffets.addFreeItem')}
          </Button>
        </div>
      </FormSection>

      <FormSection title={t('buffets.sectionPrice')}>
        <FormField
          control={form.control}
          name="pricingUnit"
          label={t('buffets.pricing')}
          render={(field) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.id} className="w-full md:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PER_PERSON">{t('buffets.pricingPerPerson')}</SelectItem>
                <SelectItem value="FLAT">{t('buffets.pricingFlat')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <PriceFields
          control={form.control}
          settings={settings}
          priceName="price"
          taxRateName="taxRateBps"
          priceValue={price}
          taxRateValue={taxRate}
          perPerson={pricingUnit === 'PER_PERSON'}
        />
        <FormField
          control={form.control}
          name="minGuests"
          label={`${t('packages.guests')} — ${t('packages.minGuests')}`}
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
                  {t('buffets.active')}
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
