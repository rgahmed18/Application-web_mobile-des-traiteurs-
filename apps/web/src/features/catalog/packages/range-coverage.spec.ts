import type { CatalogListItem } from '@traiteur/shared';
import { describe, expect, it } from 'vitest';

import { rangeCoverage } from './range-coverage';

let next = 0;
const item = (code: string, finish: CatalogListItem['finish'] = null): CatalogListItem => {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    code,
    name: { fr: code, ar: code },
    description: null,
    sortOrder: next,
    isActive: true,
    archived: false,
    finish,
    included: null,
    usageCount: 0,
  };
};
const ref = (list: CatalogListItem) => ({
  id: list.id,
  code: list.code,
  name: list.name,
  archived: false,
});

describe('couverture des gammes (Catalogue → Menus)', () => {
  const wedding = item('WEDDING');
  const aqiqa = item('AQIQA');
  const luxe = item('LUXE', 'gold');
  const essentiel = item('STANDARD', 'ivory');
  const premium = item('PREMIUM', 'bronze');
  const menu = (range: CatalogListItem, types: CatalogListItem[], extra = {}) => ({
    isActive: true,
    isPublished: true,
    archivedAt: null,
    range: ref(range),
    eventTypes: types.map(ref),
    ...extra,
  });

  it('menus publiés par événement et par gamme, Essentiel → Premium → Luxe ; cases manquantes', () => {
    const coverage = rangeCoverage(
      [
        menu(essentiel, [wedding]),
        menu(premium, [wedding]),
        menu(luxe, []), // tous les événements
        menu(premium, [aqiqa], { isPublished: false }), // hors site : ne compte pas
        menu(essentiel, [aqiqa], { archivedAt: '2026-11-01T00:00:00.000Z' }),
      ],
      [wedding, aqiqa],
      [luxe, essentiel, premium],
    );
    expect(coverage.ranges.map((range) => range.code)).toEqual(['STANDARD', 'PREMIUM', 'LUXE']);
    expect(coverage.rows.map((row) => [row.eventType.code, row.counts])).toEqual([
      ['WEDDING', [1, 1, 1]],
      ['AQIQA', [0, 0, 1]],
    ]);
    expect(coverage.missing).toBe(2);
  });
});
