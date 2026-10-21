'use client';

import {
  getLocalizedText,
  type LineItemType,
  type LocalizedText,
  type PriceMode,
} from '@traiteur/shared';
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
import {
  useBuffets,
  useDishes,
  useEquipmentList,
  useExtraServices,
  usePackages,
} from '@/features/catalog/catalog-api';
import { ItemThumb } from '@/features/catalog/components/catalog-ui';
import { useDebouncedValue } from '@/features/catalog/use-debounced-value';
import { formatMoney } from '@/lib/format/money';

/** Élément du catalogue prêt à devenir une ligne de commande. */
export interface CatalogChoice {
  itemType: Exclude<LineItemType, 'CUSTOM'>;
  id: string;
  /** Nom du catalogue dans toutes ses langues : copié tel quel sur la ligne. */
  label: LocalizedText;
  /** Prix unitaire dans le mode de prix de la commande. */
  unitPrice: number;
  taxRateBps: number;
  perPerson: boolean;
  minQuantity: number;
}

/** Stock d'un article sur la période de la commande (lignes de cette commande non comprises). */
export interface StockFigures {
  stock: number;
  remaining: number;
  pending: number;
}

interface CatalogPickerProps {
  kind: Exclude<LineItemType, 'CUSTOM'> | null;
  priceMode: PriceMode;
  /** Matériel : stock restant par article sur la période (absent tant qu'elle est incomplète). */
  stock?: ReadonlyMap<string, StockFigures>;
  onPick: (choice: CatalogChoice) => void;
  onClose: () => void;
}

interface Option extends CatalogChoice {
  displayName: string;
  imageKey: string | null;
}

/**
 * Recherche d'une formule, d'un plat, d'un buffet, d'un article de matériel ou d'un service du
 * catalogue (éléments archivés ou inactifs exclus).
 */
export function CatalogPicker({ kind, priceMode, stock, onPick, onClose }: CatalogPickerProps) {
  const t = useTranslations('orders.form.lines');
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim()) || undefined;
  const packages = usePackages({ search: debounced, status: 'active', pageSize: 50 });
  const dishes = useDishes({ search: debounced, pageSize: 50 });
  const services = useExtraServices(false);
  const equipment = useEquipmentList({ search: debounced, status: 'active', pageSize: 50 });
  const buffets = useBuffets({ search: debounced, status: 'active', pageSize: 50 });
  const price = (ht: number, ttc: number) => (priceMode === 'TTC' ? ttc : ht);

  const options: Option[] =
    kind === 'PACKAGE'
      ? (packages.data?.items ?? []).map((item) => ({
          itemType: 'PACKAGE',
          id: item.id,
          label: item.name,
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
              label: item.name,
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
                label: item.name,
                displayName: getLocalizedText(item.name, locale),
                imageKey: null,
                unitPrice: price(item.priceHt, item.priceTtc),
                taxRateBps: item.effectiveTaxRateBps,
                perPerson: item.pricingUnit === 'PER_PERSON',
                minQuantity: 1,
              }))
          : kind === 'EQUIPMENT'
            ? (equipment.data?.items ?? []).map((item) => ({
                itemType: 'EQUIPMENT',
                id: item.id,
                label: item.name,
                displayName: getLocalizedText(item.name, locale),
                imageKey: item.imageKey,
                unitPrice: price(item.priceHt, item.priceTtc),
                taxRateBps: item.effectiveTaxRateBps,
                perPerson: false,
                minQuantity: 1,
              }))
            : kind === 'BUFFET'
              ? (buffets.data?.items ?? []).map((item) => ({
                  itemType: 'BUFFET',
                  id: item.id,
                  label: item.name,
                  displayName: getLocalizedText(item.name, locale),
                  imageKey: item.imageKey,
                  unitPrice: price(item.priceHt, item.priceTtc),
                  taxRateBps: item.effectiveTaxRateBps,
                  perPerson: item.pricingUnit === 'PER_PERSON',
                  minQuantity: item.pricingUnit === 'PER_PERSON' ? item.minGuests : 1,
                }))
              : [];

  const title = {
    PACKAGE: t('addPackage'),
    DISH: t('addDish'),
    BUFFET: t('addBuffet'),
    EQUIPMENT: t('addEquipment'),
    EXTRA_SERVICE: t('addService'),
  }[kind ?? 'PACKAGE'];

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
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{option.displayName}</span>
                    {kind === 'EQUIPMENT' && stock?.get(option.id) && (
                      <StockHint figures={stock.get(option.id)} />
                    )}
                  </span>
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

/** « Reste 80 sur 200 · +60 en attente » : stock de la période, commandes en attente à part. */
export function StockHint({
  figures,
  requested = 0,
}: {
  figures: StockFigures | undefined;
  /** Quantité déjà demandée par cette commande (lignes du formulaire). */
  requested?: number;
}) {
  const t = useTranslations('orders.form.lines');
  if (!figures) return null;
  const short = requested > figures.remaining;
  return (
    <span
      className={short ? 'text-sm font-medium text-destructive' : 'text-sm text-muted-foreground'}
      data-testid="stock-hint"
    >
      {t('stockRemaining', { remaining: figures.remaining, stock: figures.stock })}
      {figures.pending > 0 && ` · ${t('stockPending', { count: figures.pending })}`}
      {short && ` · ${t('stockShort', { missing: requested - figures.remaining })}`}
    </span>
  );
}
