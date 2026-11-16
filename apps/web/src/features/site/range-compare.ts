import type { PublicCatalog, PublicMenu, PublicRange } from '@traiteur/shared';

/** Menu prévu pour ce type d'événement (un menu sans type convient à tous). */
export function menuFits(menu: Pick<PublicMenu, 'eventTypes'>, eventType: string): boolean {
  return menu.eventTypes.length === 0 || menu.eventTypes.includes(eventType);
}

/** Colonne du comparateur : une gamme et ses menus pour le type d'événement. */
export interface RangeColumn {
  range: PublicRange;
  /** Menu le moins cher de la gamme (lien « Voir le menu »). */
  menu: PublicMenu;
  /** Prix « à partir de » par personne (TTC). */
  fromPrice: number;
  /** Nombre de plats, du plus petit au plus grand menu de la gamme. */
  dishes: { min: number; max: number };
  menuCount: number;
}

const byPrice = (a: PublicMenu, b: PublicMenu) => a.pricePerPersonTtc - b.pricePerPersonTtc;

/**
 * Gammes comparées pour un type d'événement, dans l'ordre du traiteur : seulement celles qui ont
 * au moins un menu publié prévu pour ce type. `ranges` : gammes publiées (et montrées dans la
 * langue de la page).
 */
export function compareRanges(
  catalog: Pick<PublicCatalog, 'menus'>,
  ranges: PublicRange[],
  eventType: string,
): RangeColumn[] {
  return ranges.flatMap((range) => {
    const menus = catalog.menus
      .filter((menu) => menu.range?.code === range.code && menuFits(menu, eventType))
      .sort(byPrice);
    const cheapest = menus[0];
    if (!cheapest) return [];
    const counts = menus.map((menu) => menu.dishes.length);
    return [
      {
        range,
        menu: cheapest,
        fromPrice: cheapest.pricePerPersonTtc,
        dishes: { min: Math.min(...counts), max: Math.max(...counts) },
        menuCount: menus.length,
      },
    ];
  });
}

/** Le comparateur n'a de sens qu'avec au moins deux gammes. */
export const COMPARE_MIN_RANGES = 2;

/** Types d'événement (codes, dans l'ordre donné) pour lesquels au moins deux gammes se comparent. */
export function comparableEventTypes(
  catalog: Pick<PublicCatalog, 'menus'>,
  ranges: PublicRange[],
  eventTypes: string[],
): string[] {
  return eventTypes.filter(
    (code) => compareRanges(catalog, ranges, code).length >= COMPARE_MIN_RANGES,
  );
}

/** Suggestion de montée en gamme pour un menu de « Ma demande ». */
export interface Upgrade {
  from: PublicMenu;
  to: PublicMenu;
  range: PublicRange;
  /** Supplément par personne (TTC), toujours positif. */
  extraPerPerson: number;
}

/**
 * Menu équivalent dans la gamme juste au-dessus (ordre du traiteur) : publié, prévu pour au moins
 * un même type d'événement (ou pour tous si le menu choisi l'est), le moins cher, plus cher que le
 * menu choisi et pas déjà dans la demande. Null si aucun.
 */
export function upgradeFor(
  catalog: Pick<PublicCatalog, 'menus'>,
  ranges: PublicRange[],
  menu: PublicMenu,
  inCart: (menuId: string) => boolean,
): Upgrade | null {
  const position = ranges.findIndex((range) => range.code === menu.range?.code);
  if (position < 0) return null;
  for (const range of ranges.slice(position + 1)) {
    const candidates = catalog.menus
      .filter(
        (other) =>
          other.range?.code === range.code &&
          !inCart(other.id) &&
          other.pricePerPersonTtc > menu.pricePerPersonTtc &&
          (menu.eventTypes.length === 0
            ? other.eventTypes.length === 0
            : menu.eventTypes.some((code) => menuFits(other, code))),
      )
      .sort(byPrice);
    const to = candidates[0];
    if (to) {
      return {
        from: menu,
        to,
        range,
        extraPerPerson: to.pricePerPersonTtc - menu.pricePerPersonTtc,
      };
    }
    // Gamme intermédiaire sans menu équivalent : on ne saute pas à la suivante
    return null;
  }
  return null;
}

/** Lignes « inclus » propres à la gamme supérieure (absentes de la gamme du menu choisi). */
export function addedLines(from: string[], to: string[]): string[] {
  const known = new Set(from.map((line) => line.trim().toLowerCase()));
  return to.filter((line) => !known.has(line.trim().toLowerCase()));
}
