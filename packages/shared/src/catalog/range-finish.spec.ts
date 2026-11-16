import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../site/site-palettes';
import {
  parseRangeIncluded,
  RANGE_FINISH_COLORS,
  rangeFinish,
  rangeIncludedSchema,
} from './range-finish';

describe('finitions des gammes', () => {
  for (const [finish, colors] of Object.entries(RANGE_FINISH_COLORS)) {
    it(`${finish} : badge lisible (AA) et symbole visible (3:1)`, () => {
      expect(contrastRatio(colors.ink, colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.symbol, colors.background)).toBeGreaterThanOrEqual(3);
      // Badge posé sur une carte blanche ou ivoire
      expect(contrastRatio(colors.ink, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('valeur inconnue : ivoire', () => {
    expect(rangeFinish('gold')).toBe('gold');
    expect(rangeFinish('platine')).toBe('ivory');
    expect(rangeFinish(null)).toBe('ivory');
  });

  it('« Ce qui est inclus » : lignes non vides, 12 au plus ; valeur inattendue : vide', () => {
    expect(rangeIncludedSchema.safeParse({ fr: ['Service'], ar: [] }).success).toBe(true);
    expect(rangeIncludedSchema.safeParse({ fr: ['  '], ar: [] }).success).toBe(false);
    expect(
      rangeIncludedSchema.safeParse({ fr: Array.from({ length: 13 }, () => 'x'), ar: [] }).success,
    ).toBe(false);
    expect(parseRangeIncluded({ fr: ['Thé'], ar: ['أتاي'] })).toEqual({
      fr: ['Thé'],
      ar: ['أتاي'],
    });
    expect(parseRangeIncluded(null)).toEqual({ fr: [], ar: [] });
  });
});
