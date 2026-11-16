import { z } from 'zod';

/**
 * Palettes du site client, au choix du traiteur (Paramètres → Site client). Chaque palette est
 * harmonieuse et lisible : contraste vérifié (WCAG AA, 4,5:1) pour le texte blanc sur la couleur
 * principale, la couleur principale et le texte d'accent sur le fond ivoire et sur le fond sable
 * (voir site-palettes.spec.ts). La couleur d'accent (`accent`) ne sert qu'aux ornements.
 */
export interface SitePalette {
  /** Boutons, liens, blocs de couleur ; texte blanc dessus. */
  primary: string;
  /** Ornements (filets, points, chiffres décoratifs de grande taille). */
  accent: string;
  /** Petits titres d'accent (« Pour vos événements ») sur fond clair. */
  accentText: string;
  /** Fond de page. */
  background: string;
  /** Fond des sections alternées. */
  sand: string;
}

export const SITE_PALETTES = {
  terracotta: {
    primary: '#9a3f26',
    accent: '#c49a4a',
    accentText: '#865a1b',
    background: '#fbf7f0',
    sand: '#f3ebde',
  },
  plum: {
    primary: '#6d1f52',
    accent: '#ff7a59',
    accentText: '#b03d20',
    background: '#fdf8f8',
    sand: '#f8eaee',
  },
  emerald: {
    primary: '#0f5c4a',
    accent: '#c49a4a',
    accentText: '#7a5716',
    background: '#f8f8f2',
    sand: '#ebefe4',
  },
  majorelle: {
    primary: '#2443a3',
    accent: '#e0a526',
    accentText: '#865700',
    background: '#f9f8f3',
    sand: '#eceee8',
  },
  bordeaux: {
    primary: '#7a1f2b',
    accent: '#d88c9a',
    accentText: '#9c3548',
    background: '#fcf8f6',
    sand: '#f5e9e6',
  },
  night: {
    primary: '#1f2a44',
    accent: '#c8a26b',
    accentText: '#7a5a2a',
    background: '#f9f7f2',
    sand: '#efeae0',
  },
} as const satisfies Record<string, SitePalette>;

export const SITE_PALETTE_CODES = Object.keys(SITE_PALETTES) as (keyof typeof SITE_PALETTES)[];
export const sitePaletteSchema = z.enum(SITE_PALETTE_CODES as [string, ...string[]]);
export type SitePaletteCode = keyof typeof SITE_PALETTES;

/** Palette par défaut (« Terre cuite ») : celle d'un traiteur qui n'a rien choisi. */
export const DEFAULT_SITE_PALETTE: SitePaletteCode = 'terracotta';

/** Palette d'un code (inconnu ou absent : la palette par défaut). */
export function sitePalette(code: string | null | undefined): SitePalette {
  return code && code in SITE_PALETTES
    ? SITE_PALETTES[code as SitePaletteCode]
    : SITE_PALETTES[DEFAULT_SITE_PALETTE];
}

/** Luminance relative d'une couleur « #rrggbb » (WCAG 2). */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs « #rrggbb » (1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
