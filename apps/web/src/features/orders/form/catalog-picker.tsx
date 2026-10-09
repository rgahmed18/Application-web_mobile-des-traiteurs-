'use client';

import { getLocalizedText, type LineItemType, type Locale, type PriceMode } from '@traiteur/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDishes, useExtraServices, usePackages } from '@/features/catalog/catalog-api';
import { ItemThumb } from '@/features/catalog/components/catalog-ui';
import { useDebouncedValue } from '@/features/catalog/use-debounced-value';
import { formatMoney } from '@/lib/format/money';

/** Élément du catalogue prêt à devenir une ligne de commande. */
export interface CatalogChoice {
  itemType: Exclude<LineItemType, 'CUSTOM'>;
  id: string;
  /** Libellé figé dans la langue du client. */
  label: string;
  /** Prix unitaire dans le mode de prix de la commande. */
  unitPrice: number;
  taxRateBps: number;
  perPerson: boolean;
  minQuantity: number;
}

interface CatalogPickerProps {
  kind: Exclude<LineItemType, 'CUSTOM'> | null;
  priceMode: PriceMode;
  /** Langue des libellés enregistrés (celle du client). */
  labelLocale: Locale;
  onPick: (choice: CatalogChoice) => void;
  onClose: () => void;
}

interface Option extends CatalogChoice {
  displayName: string;
  imageKey: string | null;
}

/** Recherche d'une formule, d'un plat ou d'un service du catalogue (éléments archivés exclus). */
export function CatalogPicker({
  kind,
  priceMode,
  labelLocale,
  onPick,
  onClose,
}: CatalogPickerProps) {
  const t = useTranslations('orders.form.lines');
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim()) || undefined;
  const packages = usePackages({ search: debounced, status: 'active', pageSize: 50 });
  const dishes = useDishes({ search: debounced, pageSize: 50 });
  const services = useExtraServices(false);
  const price = (ht: number, ttc: number) => (priceMode === 'TTC' ? ttc : ht);

  const options: Option[] =
    kind === 'PACKAGE'
      ? (packages.data?.items ?? []).map((item) => ({
          itemType: 'PACKAGE',
          id: item.id,
          label: getLocalizedText(item.name, labelLocale),
          displayName: getLocalizedText(item.name, locale),
          imageKey: item.imageKey,
          unitPrice: price(item.pricePerPersonHt, item.pricePerPersonTtc),
          taxRateBps: item.effectiveTaxRateBps,
          perPerson: true,
          minQuantity: item.minGuests,
        }))
      : kind === 'DISH'
        ? (dishes.data?.items ?? [])
            .filter((item) => item.isAvailable)
            .map((item) => ({
              itemType: 'DISH',
              id: item.id,
              label: getLocalizedText(item.name, labelLocale),
              displayName: getLocalizedText(item.name, locale),
              imageKey: item.imageKey,
              unitPrice: price(item.priceHt, item.priceTtc),
              taxRateBps: item.effectiveTaxRateBps,
              perPerson: item.unit === 'PER_PERSON',
              minQuantity: item.minQuantity,
            }))
        : kind === 'EXTRA_SERVICE'
          ? (services.data ?? [])
              .filter((item) => item.isActive)
              .filter((item) =>
                debounced
                  ? getLocalizedText(item.name, locale)
                      .toLowerCase()
                      .includes(debounced.toLowerCase())
                  : true,
              )
              .map((item) => ({
                itemType: 'EXTRA_SERVICE',
                id: item.id,
                label: getLocalizedText(item.name, labelLocale),
                displayName: getLocalizedText(item.name, locale),
                imageKey: null,
                unitPrice: price(item.priceHt, item.priceTtc),
                taxRateBps: item.effectiveTaxRateBps,
                perPerson: item.pricingUnit === 'PER_PERSON',
                minQuantity: 1,
              }))
          : [];

  const title =
    kind === 'PACKAGE' ? t('addPackage') : kind === 'DISH' ? t('addDish') : t('addService');

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('searchCatalog')}
            value={search}
            onValueChange={setSearch}
            className="h-11 text-base"
          />
          <CommandList className="max-h-[50dvh]">
            <CommandEmpty>{t('noCatalogResult')}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  className="gap-3 py-2"
                  onSelect={() => {
                    const { displayName: _name, imageKey: _image, ...choice } = option;
                    onPick(choice);
                    setSearch('');
                  }}
                >
                  {kind !== 'EXTRA_SERVICE' && <ItemThumb imageKey={option.imageKey} alt="" />}
                  <span className="flex-1 truncate">{option.displayName}</span>
                  <span className="text-sm text-muted-foreground" dir="ltr">
                    {formatMoney(option.unitPrice, locale)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
