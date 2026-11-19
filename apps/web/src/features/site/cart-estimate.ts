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

/** Fourchette d'un total : égale (min = max) quand aucune formule n'est en balance. */
export interface EstimateRange {
  min: number;
  max: number;
}

/**
 * Fourchette d'un total : montants additionnés normalement, et pour chaque groupe d'alternatives
 * (formules entre lesquelles le client hésite, il n'en prendra qu'une) la moins chère au minimum,
 * la plus chère au maximum. Sert à « Ma demande » et au back-office.
 */
export function totalRange(fixed: number[], alternatives: number[][]): EstimateRange {
  const base = fixed.reduce((total, amount) => total + amount, 0);
  return alternatives
    .filter((group) => group.length > 0)
    .reduce(
      (range, group) => ({
        min: range.min + Math.min(...group),
        max: range.max + Math.max(...group),
      }),
      { min: base, max: base },
    );
}

interface EstimateLine {
  entry: Pick<CatalogEntry, 'kind' | 'id' | 'priceTtc' | 'unit'>;
  quantity: number;
}

/**
 * Total estimé de « Ma demande » : null si une ligne par personne attend encore le nombre
 * d'invités. `groups` : formules (identifiants de menus) en alternative, voir alternativeGroups.
 */
export function cartEstimate(
  lines: EstimateLine[],
  guests: number | null,
  groups: string[][] = [],
): EstimateRange | null {
  const grouped = new Set(groups.flat());
  const fixed: number[] = [];
  const amounts = new Map<string, number>();
  for (const line of lines) {
    const amount = lineEstimate(line.entry, line.quantity, guests);
    if (amount === null) return null;
    if (line.entry.kind === 'menu' && grouped.has(line.entry.id)) {
      amounts.set(line.entry.id, amount);
    } else fixed.push(amount);
  }
  return totalRange(
    fixed,
    groups.map((group) => group.flatMap((id) => amounts.get(id) ?? [])),
  );
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

/**
 * Formules en alternative : groupes (identifiants) de menus prévus pour un même événement, de
 * deux menus au moins. Le client n'en prendra qu'une par groupe.
 */
export function alternativeGroups(cartMenus: Pick<PublicMenu, 'id' | 'eventTypes'>[]): string[][] {
  const groups: Pick<PublicMenu, 'id' | 'eventTypes'>[][] = [];
  for (const menu of cartMenus) {
    const linked = groups.filter((group) => group.some((other) => overlap(menu, other)));
    const merged = [...linked.flat(), menu];
    for (const group of linked) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups.filter((group) => group.length > 1).map((group) => group.map((menu) => menu.id));
}

/** Plusieurs formules pour un même événement : le client hésite entre des gammes. */
export function hesitating(cartMenus: Pick<PublicMenu, 'id' | 'eventTypes'>[]): boolean {
  return alternativeGroups(cartMenus).length > 0;
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

/** Montant estimé sans devise (début d'une fourchette) : « 42 000 », isolé en arabe. */
export function formatEstimateAmount(
  cents: number,
  locale: 'fr' | 'ar',
  format: (cents: number, locale: 'fr' | 'ar') => string,
): string {
  // Montant seul : celui du format unique, sans la devise ni ses isolats
  const full = formatEstimate(cents, 'fr', format).replace(/\u00a0MAD$/, '');
  return locale === 'ar' ? `\u2066${full}\u2069` : full;
}
