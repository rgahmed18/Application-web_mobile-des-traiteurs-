import type { CatalogEntry } from './catalog-view';

/**
 * Cohérence de la demande, sans jamais bloquer : type d'événement des formules, limites
 * d'invités propres à un menu (le traiteur ajuste dans son devis).
 */
type MenuEntry = Pick<CatalogEntry, 'id' | 'name' | 'eventTypes' | 'minGuests' | 'maxGuests'>;

/** Type commun à toutes les formules (prévues pour un seul et même type), sinon null. */
export function commonEventType(menus: Pick<MenuEntry, 'eventTypes'>[]): string | null {
  const typed = menus.filter((menu) => menu.eventTypes.length > 0);
  if (typed.length === 0) return null;
  const [first, ...others] = typed;
  const common = (first?.eventTypes ?? []).filter((code) =>
    others.every((menu) => menu.eventTypes.includes(code)),
  );
  return common.length === 1 ? (common[0] ?? null) : null;
}

/** Première formule prévue pour d'autres types que celui choisi (avec ses types). */
export function typeMismatch<T extends Pick<MenuEntry, 'eventTypes'>>(
  menus: T[],
  eventType: string,
): { menu: T; expected: string[] } | null {
  const menu = menus.find(
    (candidate) => candidate.eventTypes.length > 0 && !candidate.eventTypes.includes(eventType),
  );
  return menu ? { menu, expected: menu.eventTypes } : null;
}

/** Formules dont les limites d'invités (ex. 80 à 600) ne couvrent pas ce nombre. */
export function outsideMenuLimits<T extends Pick<MenuEntry, 'minGuests' | 'maxGuests'>>(
  menus: T[],
  guests: number,
): T[] {
  return menus.filter(
    (menu) =>
      (menu.minGuests !== null && guests < menu.minGuests) ||
      (menu.maxGuests !== null && guests > menu.maxGuests),
  );
}
