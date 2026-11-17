import type { CatalogListItem, Package } from '@traiteur/shared';

/** Ordre des finitions : Essentiel (ivoire), Premium (bronze), Luxe (or). */
const FINISH_RANK = { ivory: 0, bronze: 1, gold: 2 } as const;

export interface CoverageRow {
  eventType: CatalogListItem;
  /** Nombre de menus publiés par gamme (même ordre que `ranges`). */
  counts: number[];
}

export interface Coverage {
  ranges: CatalogListItem[];
  rows: CoverageRow[];
  /** Cases sans menu publié (gamme « sur demande » dans le comparateur du site). */
  missing: number;
}

const usable = (item: CatalogListItem) => item.isActive && !item.archived;

/**
 * Couverture des gammes par type d'événement : menus disponibles, publiés sur le site et non
 * archivés (un menu sans type d'événement compte pour tous). Gammes dans l'ordre Essentiel →
 * Premium → Luxe, types d'événement dans l'ordre de la liste.
 */
export function rangeCoverage(
  packages: Pick<Package, 'isActive' | 'isPublished' | 'archivedAt' | 'range' | 'eventTypes'>[],
  eventTypes: CatalogListItem[],
  ranges: CatalogListItem[],
): Coverage {
  const columns = ranges
    .filter(usable)
    .map((range, index) => ({ range, index }))
    .sort(
      (a, b) =>
        FINISH_RANK[a.range.finish ?? 'ivory'] - FINISH_RANK[b.range.finish ?? 'ivory'] ||
        a.index - b.index,
    )
    .map(({ range }) => range);
  const published = packages.filter((pkg) => pkg.isActive && pkg.isPublished && !pkg.archivedAt);
  const rows = eventTypes.filter(usable).map((eventType) => ({
    eventType,
    counts: columns.map(
      (range) =>
        published.filter(
          (pkg) =>
            pkg.range?.id === range.id &&
            (pkg.eventTypes.length === 0 ||
              pkg.eventTypes.some((type) => type.id === eventType.id)),
        ).length,
    ),
  }));
  const missing = rows.reduce((total, row) => total + row.counts.filter((n) => n === 0).length, 0);
  return { ranges: columns, rows, missing };
}
