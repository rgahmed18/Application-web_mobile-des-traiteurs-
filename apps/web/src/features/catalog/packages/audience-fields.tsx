'use client';

import type { Package } from '@traiteur/shared';
import { useTranslations } from 'next-intl';
import { type Control, Controller, type FieldValues } from 'react-hook-form';

import { FormField } from '@/components/forms/form-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCatalogList } from '../catalog-api';
import { useLocalized } from '../use-localized';
import type { PackageFormValues } from './package-form-schema';

const NO_RANGE = 'none';

/**
 * Événements et gamme d'un menu : types d'événement auxquels il est proposé (aucun : tous) et
 * gamme. Un élément archivé ou désactivé n'est proposé que s'il est déjà porté par ce menu.
 */
export function AudienceFields({
  control,
  pkg,
}: {
  control: Control<PackageFormValues, unknown, FieldValues>;
  pkg?: Package;
}) {
  const t = useTranslations('catalog');
  const localized = useLocalized();
  const ranges = useCatalogList('ranges');
  const eventTypes = useCatalogList('event-types');
  const keptRange = pkg?.range?.id;
  const keptTypes = new Set(pkg?.eventTypes.map((type) => type.id));
  const rangeOptions = (ranges.data ?? []).filter(
    (item) => (item.isActive && !item.archived) || item.id === keptRange,
  );
  const typeOptions = (eventTypes.data ?? []).filter(
    (item) => (item.isActive && !item.archived) || keptTypes.has(item.id),
  );

  return (
    <div className="flex flex-col gap-6">
      <FormField
        control={control}
        name="rangeId"
        label={t('packages.range')}
        render={(field) => (
          <Select
            value={field.value === '' ? NO_RANGE : field.value}
            onValueChange={(value) => field.onChange(value === NO_RANGE ? '' : value)}
          >
            <SelectTrigger id={field.id} className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_RANGE}>{t('packages.noRange')}</SelectItem>
              {rangeOptions.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {localized(item.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <Controller
        control={control}
        name="eventTypeIds"
        render={({ field }) => (
          <FieldSet>
            <FieldLegend variant="label">{t('packages.eventTypes')}</FieldLegend>
            <FieldDescription>{t('packages.eventTypesHint')}</FieldDescription>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="event-types">
              {typeOptions.map((item) => {
                const checked = field.value.includes(item.id);
                const id = `event-type-${item.id}`;
                return (
                  <Field key={item.id} orientation="horizontal">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(value) =>
                        field.onChange(
                          value === true
                            ? [...field.value, item.id]
                            : field.value.filter((selected) => selected !== item.id),
                        )
                      }
                    />
                    <label htmlFor={id} className="text-base">
                      {localized(item.name)}
                    </label>
                  </Field>
                );
              })}
            </div>
          </FieldSet>
        )}
      />
    </div>
  );
}
