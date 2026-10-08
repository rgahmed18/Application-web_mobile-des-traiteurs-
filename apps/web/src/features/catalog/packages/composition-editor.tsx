'use client';

import type { CatalogSettings, Dish, Package } from '@traiteur/shared';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  type Control,
  type FieldValues,
  useFieldArray,
  useFormState,
  useWatch,
} from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { FieldDescription, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatMoney } from '@/lib/format/money';

import { useDishes } from '../catalog-api';
import { ItemThumb } from '../components/catalog-ui';
import { useDebouncedValue } from '../use-debounced-value';
import { useLocalized } from '../use-localized';
import { compositionValue, type PackageFormValues } from './package-form-schema';

/** Informations d'affichage d'un plat de la composition (hors données du formulaire). */
export type DishSummary = Pick<
  Dish,
  'id' | 'name' | 'priceHt' | 'priceTtc' | 'unit' | 'imageKey'
> & {
  archived: boolean;
};

export function summariesFromPackage(pkg: Package | undefined): Map<string, DishSummary> {
  return new Map(
    (pkg?.dishes ?? []).map((line) => [
      line.dishId,
      { ...line.dish, archived: line.dish.archivedAt !== null },
    ]),
  );
}

interface CompositionEditorProps {
  control: Control<PackageFormValues, unknown, FieldValues>;
  settings: CatalogSettings;
  summaries: Map<string, DishSummary>;
  onSummary: (summary: DishSummary) => void;
}

/** Plats de la formule et quantité par personne ; ajout par recherche, retrait d'un geste. */
export function CompositionEditor({
  control,
  settings,
  summaries,
  onSummary,
}: CompositionEditorProps) {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const localized = useLocalized();
  const { fields, append, remove } = useFieldArray({ control, name: 'dishes' });
  const lines = useWatch({ control, name: 'dishes' });
  const { errors } = useFormState({ control, name: 'dishes' });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const options = useDishes({ search: debouncedSearch || undefined, page: 1, pageSize: 50 });

  const ttcMode = settings.priceEntryMode === 'TTC';
  const unitPrice = (summary: DishSummary | undefined) =>
    summary ? (ttcMode ? summary.priceTtc : summary.priceHt) : 0;
  const selected = new Set(lines.map((line) => line.dishId));
  const listError = errors.dishes?.root?.message ?? errors.dishes?.message;

  return (
    <div className="flex flex-col gap-4">
      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">
          {t('packages.noDishes')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="composition">
          {fields.map((field, index) => {
            const summary = summaries.get(field.dishId);
            const name = summary ? localized(summary.name) : '…';
            const quantityError =
              errors.dishes?.[index]?.quantity?.message ?? errors.dishes?.[index]?.dishId?.message;
            return (
              <li key={field.id} className="flex flex-wrap items-center gap-3 p-3">
                <ItemThumb imageKey={summary?.imageKey ?? null} alt={t('photo.alt', { name })} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {name}
                    {summary?.archived && (
                      <span className="ms-2 text-sm text-muted-foreground">
                        ({t('packages.archivedDish')})
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground" dir="auto">
                    {formatMoney(unitPrice(summary), locale)} ·{' '}
                    {summary && t(`units.${summary.unit}`)}
                  </p>
                  {quantityError && <FieldError>{quantityError}</FieldError>}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only sm:not-sr-only">{t('packages.quantity')}</span>
                  <Input
                    className="w-20 text-center"
                    inputMode="numeric"
                    dir="ltr"
                    aria-label={`${t('packages.quantity')} — ${name}`}
                    {...control.register(`dishes.${index}.quantity`)}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('packages.removeDish', { name })}
                  onClick={() => remove(index)}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {listError && <FieldError>{t('packages.noDishes')}</FieldError>}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="self-start">
            <PlusIcon aria-hidden />
            {t('packages.addDish')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t('packages.searchDish')}
              value={search}
              onValueChange={setSearch}
              className="h-11 text-base"
            />
            <CommandList>
              <CommandEmpty>{t('packages.noDishFound')}</CommandEmpty>
              <CommandGroup>
                {(options.data?.items ?? [])
                  .filter((dish) => !selected.has(dish.id))
                  .map((dish) => (
                    <CommandItem
                      key={dish.id}
                      value={dish.id}
                      className="gap-3 py-2"
                      onSelect={() => {
                        onSummary({ ...dish, archived: dish.archivedAt !== null });
                        append({ dishId: dish.id, quantity: '1' });
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <ItemThumb imageKey={dish.imageKey} alt="" />
                      <span className="flex-1 truncate">{localized(dish.name)}</span>
                      <span className="text-sm text-muted-foreground" dir="ltr">
                        {formatMoney(ttcMode ? dish.priceTtc : dish.priceHt, locale)}
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FieldDescription>{t('packages.compositionHint')}</FieldDescription>
    </div>
  );
}

/** Valeur des plats au détail, affichée à côté du prix par personne (indicatif). */
export function CompositionValue({
  control,
  settings,
  summaries,
}: Pick<CompositionEditorProps, 'control' | 'settings' | 'summaries'>) {
  const t = useTranslations('catalog.packages');
  const locale = useLocale();
  const lines = useWatch({ control, name: 'dishes' });
  const ttcMode = settings.priceEntryMode === 'TTC';
  const value = compositionValue(
    lines.map((line) => {
      const summary = summaries.get(line.dishId);
      return {
        unitPrice: summary ? (ttcMode ? summary.priceTtc : summary.priceHt) : 0,
        quantity: line.quantity,
      };
    }),
  );
  return (
    <div className="rounded-lg bg-muted/60 p-4" data-testid="composition-value">
      <p className="text-sm text-muted-foreground">{t('dishesValue')}</p>
      <p className="text-2xl font-semibold tabular-nums" dir="ltr">
        {formatMoney(value, locale)}
      </p>
      <p className="text-sm text-muted-foreground">{t('dishesValueHint')}</p>
    </div>
  );
}
