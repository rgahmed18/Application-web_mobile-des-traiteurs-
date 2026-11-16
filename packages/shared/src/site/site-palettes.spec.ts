import { describe, expect, it } from 'vitest';

import { contrastRatio, SITE_PALETTES, sitePalette } from './site-palettes';

/** WCAG AA pour du texte courant. */
const AA = 4.5;

describe('palettes du site client : contraste vérifié', () => {
  it('rapport de contraste WCAG', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  for (const [code, palette] of Object.entries(SITE_PALETTES)) {
    it(`${code} : texte blanc sur la couleur principale, textes sur les fonds clairs`, () => {
      expect(contrastRatio('#ffffff', palette.primary)).toBeGreaterThanOrEqual(AA);
      for (const background of [palette.background, palette.sand]) {
        expect(contrastRatio(palette.primary, background)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(palette.accentText, background)).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  it('code inconnu : palette par défaut', () => {
    expect(sitePalette('inconnue')).toBe(SITE_PALETTES.terracotta);
    expect(sitePalette(null)).toBe(SITE_PALETTES.terracotta);
    expect(sitePalette('plum')).toBe(SITE_PALETTES.plum);
  });
});
