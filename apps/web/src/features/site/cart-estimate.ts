import type { PublicMenu } from '@traiteur/shared';

import type { CatalogEntry } from './catalog-view';
import { menuFits } from './range-compare';

/**
 * Estimation TTC d'une ligne de « Ma demande » : par personne × nombre d'invités (null tant que
 * le nombre n'est pas saisi), forfait, ou prix × quantité (matériel, services à l'unité ou à
 * l'heure). Le devis final reste celui du traiteur.
 */
export function lineEstimate(
  entry: Pick<CatalogEntry, 'priceTtc' | 'unit'>,
  quantity: number,
  guests: number | null,
): number | null {
  if (entry.unit === 'perPerson') return guests === null ? null : entry.priceTtc * guests;
  if (entry.unit === 'flat') return entry.priceTtc;
  return entry.priceTtc * quantity;
}

/** Total estimé : null si une ligne par personne attend encore le nombre d'invités. */
export function cartEstimate(
  lines: { entry: Pick<CatalogEntry, 'priceTtc' | 'unit'>; quantity: number }[],
  guests: number | null,
): number | null {
  let total = 0;
  for (const line of lines) {
    const amount = lineEstimate(line.entry, line.quantity, guests);
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

/** Deux menus prévus pour au moins un même événement (un menu sans type convient à tous). */
function overlap(a: Pick<PublicMenu, 'eventTypes'>, b: Pick<PublicMenu, 'eventTypes'>): boolean {
  if (a.eventTypes.length === 0 || b.eventTypes.length === 0) return true;
  return a.eventTypes.some((code) => b.eventTypes.includes(code));
}

/**
 * Formule de « Ma demande » déjà prévue pour cet événement (autre que celle choisie) : le client
 * peut la remplacer ou garder les deux.
 */
export function menuForEvent(
  cartMenus: PublicMenu[],
  eventType: string,
  chosenId: string,
): PublicMenu | null {
  return cartMenus.find((menu) => menu.id !== chosenId && menuFits(menu, eventType)) ?? null;
}

/** Plusieurs formules pour un même événement : le client hésite entre des gammes. */
export function hesitating(cartMenus: Pick<PublicMenu, 'eventTypes'>[]): boolean {
  return cartMenus.some((menu, index) =>
    cartMenus.slice(index + 1).some((other) => overlap(menu, other)),
  );
}

/**
 * Montant estimé arrondi à la dizaine de dirhams, sans décimales : « 42 000 MAD »,
 * « 42 000 د.م. » (format des montants de l'application).
 */
export function formatEstimate(
  cents: number,
  locale: 'fr' | 'ar',
  format: (cents: number, locale: 'fr' | 'ar') => string,
): string {
  return format(Math.round(cents / 1000) * 1000, locale).replace(/[,.]00(?=\D*$)/, '');
}
