import type { PublicCatalog, PublicMenu, PublicRange } from '@traiteur/shared';

/** Menu prévu pour ce type d'événement (un menu sans type convient à tous). */
export function menuFits(menu: Pick<PublicMenu, 'eventTypes'>, eventType: string): boolean {
  return menu.eventTypes.length === 0 || menu.eventTypes.includes(eventType);
}

/** Ordre des finitions : Essentiel (ivoire), Premium (bronze), Luxe (or). */
const FINISH_RANK: Record<PublicRange['finish'], number> = { ivory: 0, bronze: 1, gold: 2 };

/** Gammes dans l'ordre Essentiel → Premium → Luxe (ordre du traiteur à finition égale). */
export function orderedRanges(ranges: readonly PublicRange[]): PublicRange[] {
  return ranges
    .map((range, index) => ({ range, index }))
    .sort((a, b) => FINISH_RANK[a.range.finish] - FINISH_RANK[b.range.finish] || a.index - b.index)
    .map(({ range }) => range);
}

/**
 * Colonne du comparateur : une gamme et ses menus pour le type d'événement. Sans menu publié
 * (`menu` null), la gamme reste montrée « sur demande » (description, ce qui est inclus).
 */
export interface RangeColumn {
  range: PublicRange;
  /** Menu le moins cher de la gamme (« Choisir cette gamme », « Voir le menu »). */
  menu: PublicMenu | null;
  /** Prix « à partir de » par personne (TTC), null : sur demande. */
  fromPrice: number | null;
  /** Nombre de plats, du plus petit au plus grand menu de la gamme. */
  dishes: { min: number; max: number } | null;
  menuCount: number;
}

const byPrice = (a: PublicMenu, b: PublicMenu) => a.pricePerPersonTtc - b.pricePerPersonTtc;

/** Menus publiés d'une gamme prévus pour ce type d'événement, du moins cher au plus cher. */
function rangeMenus(
  catalog: Pick<PublicCatalog, 'menus'>,
  range: PublicRange,
  eventType: string,
): PublicMenu[] {
  return catalog.menus
    .filter((menu) => menu.range?.code === range.code && menuFits(menu, eventType))
    .sort(byPrice);
}

/**
 * Colonnes du comparateur pour un type d'événement : TOUTES les gammes publiées (et montrées dans
 * la langue de la page), dans l'ordre Essentiel → Premium → Luxe, avec ou sans menu.
 */
export function compareRanges(
  catalog: Pick<PublicCatalog, 'menus'>,
  ranges: readonly PublicRange[],
  eventType: string,
): RangeColumn[] {
  return orderedRanges(ranges).map((range) => {
    const menus = rangeMenus(catalog, range, eventType);
    const cheapest = menus[0] ?? null;
    const counts = menus.map((menu) => menu.dishes.length);
    return {
      range,
      menu: cheapest,
      fromPrice: cheapest?.pricePerPersonTtc ?? null,
      dishes: cheapest ? { min: Math.min(...counts), max: Math.max(...counts) } : null,
      menuCount: menus.length,
    };
  });
}

/**
 * Types d'événement (codes, dans l'ordre donné) qui ont un comparateur : au moins un menu publié
 * d'une gamme pour cet événement. Jamais de comparateur vide.
 */
export function comparableEventTypes(
  catalog: Pick<PublicCatalog, 'menus'>,
  ranges: readonly PublicRange[],
  eventTypes: readonly string[],
): string[] {
  return eventTypes.filter((code) =>
    compareRanges(catalog, ranges, code).some((column) => column.menu !== null),
  );
}

/** Estimation TTC pour un nombre d'invités (prix par personne × invités), null : sur demande. */
export function estimateTotal(column: RangeColumn, guests: number): number | null {
  return column.fromPrice === null ? null : column.fromPrice * guests;
}

/** Ordre du téléphone : gamme mise en avant en premier, les autres dans leur ordre. */
export function highlightFirst(columns: RangeColumn[], highlight: string | null): RangeColumn[] {
  const index = columns.findIndex((column) => column.range.code === highlight);
  if (index <= 0) return columns;
  return [columns[index] as RangeColumn, ...columns.filter((_, i) => i !== index)];
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
  ranges: readonly PublicRange[],
  menu: PublicMenu,
  inCart: (menuId: string) => boolean,
): Upgrade | null {
  const ordered = orderedRanges(ranges);
  const position = ordered.findIndex((range) => range.code === menu.range?.code);
  if (position < 0) return null;
  for (const range of ordered.slice(position + 1)) {
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
