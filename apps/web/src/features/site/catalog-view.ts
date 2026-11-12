import type { LocalizedText, PricingUnit, PublicCatalog, PublicListItem } from '@traiteur/shared';

import type { CartKind } from './cart-store';

/** Unité affichée à côté d'un prix TTC. */
export type PriceUnit = 'perPerson' | 'flat' | 'perUnit' | 'perHour';

/** Élément du catalogue public, quel que soit son type (affichage uniforme sur le site). */
export interface CatalogEntry {
  kind: CartKind;
  id: string;
  name: LocalizedText;
  description: LocalizedText | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  range: PublicListItem | null;
  /** Catégorie du matériel, type du buffet. */
  group: PublicListItem | null;
  priceTtc: number;
  unit: PriceUnit;
  minGuests: number | null;
  maxGuests: number | null;
  dishes: { name: LocalizedText; quantity: number }[];
  freeItems: LocalizedText[];
}

const UNIT: Record<PricingUnit, PriceUnit> = {
  FLAT: 'flat',
  PER_PERSON: 'perPerson',
  PER_HOUR: 'perHour',
  PER_UNIT: 'perUnit',
};

/** Tous les éléments du catalogue, par type, dans l'ordre du traiteur. */
export function catalogEntries(catalog: PublicCatalog): Record<CartKind, CatalogEntry[]> {
  const base = { group: null, minGuests: null, maxGuests: null, dishes: [], freeItems: [] };
  return {
    menu: catalog.menus.map((menu) => ({
      ...base,
      kind: 'menu',
      id: menu.id,
      name: menu.name,
      description: menu.description,
      imageUrl: menu.imageUrl,
      thumbUrl: menu.thumbUrl,
      range: menu.range,
      priceTtc: menu.pricePerPersonTtc,
      unit: 'perPerson',
      minGuests: menu.minGuests,
      maxGuests: menu.maxGuests,
      dishes: menu.dishes,
    })),
    buffet: catalog.buffets.map((buffet) => ({
      ...base,
      kind: 'buffet',
      id: buffet.id,
      name: buffet.name,
      description: buffet.description,
      imageUrl: buffet.imageUrl,
      thumbUrl: buffet.thumbUrl,
      range: buffet.range,
      group: buffet.type,
      priceTtc: buffet.priceTtc,
      unit: UNIT[buffet.pricingUnit],
      minGuests: buffet.minGuests,
      dishes: buffet.dishes,
      freeItems: buffet.freeItems,
    })),
    equipment: catalog.equipment.map((item) => ({
      ...base,
      kind: 'equipment',
      id: item.id,
      name: item.name,
      description: item.description,
      imageUrl: item.imageUrl,
      thumbUrl: item.thumbUrl,
      range: item.range,
      group: item.category,
      priceTtc: item.priceTtc,
      unit: 'perUnit',
    })),
    service: catalog.services.map((service) => ({
      ...base,
      kind: 'service',
      id: service.id,
      name: service.name,
      description: service.description,
      imageUrl: null,
      thumbUrl: null,
      range: null,
      priceTtc: service.priceTtc,
      unit: UNIT[service.pricingUnit],
    })),
  };
}

/** Élément d'un type et d'un identifiant donnés, ou null s'il n'est plus publié. */
export function findEntry(catalog: PublicCatalog, kind: CartKind, id: string): CatalogEntry | null {
  return catalogEntries(catalog)[kind].find((entry) => entry.id === id) ?? null;
}
