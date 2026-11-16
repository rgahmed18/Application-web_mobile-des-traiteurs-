import { z } from 'zod';

/**
 * Finition d'une gamme sur le site client : couleur, symbole et style de carte. Ivoire (sobre),
 * bronze (reflet), or (bordure dorée, titre calligraphié). La couleur n'est jamais seule : le
 * badge montre toujours le symbole et le nom de la gamme.
 */
export const RANGE_FINISHES = ['ivory', 'bronze', 'gold'] as const;
export const rangeFinishSchema = z.enum(RANGE_FINISHES);
export type RangeFinish = z.infer<typeof rangeFinishSchema>;

/** Lignes de « Ce qui est inclus » (par langue) : courtes, 12 au plus. */
export const RANGE_INCLUDED_MAX = 12;
const includedLines = z.array(z.string().trim().min(1).max(160)).max(RANGE_INCLUDED_MAX);

/** « Ce qui est inclus » dans une gamme, saisi par le traiteur en français et en arabe. */
export const rangeIncludedSchema = z.object({ fr: includedLines, ar: includedLines });
export type RangeIncluded = z.infer<typeof rangeIncludedSchema>;

export const EMPTY_RANGE_INCLUDED: RangeIncluded = { fr: [], ar: [] };

/** Couleurs d'une finition : texte du badge (ink) sur son fond, symbole, bordure. */
export interface RangeFinishColors {
  /** Texte du badge et des titres (contraste AA sur `background`). */
  ink: string;
  background: string;
  /** Symbole et coches (contraste ≥ 3:1 sur `background`, élément graphique). */
  symbol: string;
  border: string;
}

export const RANGE_FINISH_COLORS: Record<RangeFinish, RangeFinishColors> = {
  ivory: { ink: '#4a3d2c', background: '#f7f2e9', symbol: '#7d6d55', border: '#e3d8c6' },
  bronze: { ink: '#6b4421', background: '#f6ece0', symbol: '#9a6634', border: '#d9b48a' },
  gold: { ink: '#5c4210', background: '#f4ead3', symbol: '#8a6514', border: '#d6ad4a' },
};

/** Finition lue en base (texte libre contrôlé par la base) : ivoire si inconnue. */
export function rangeFinish(value: string | null | undefined): RangeFinish {
  return RANGE_FINISHES.find((finish) => finish === value) ?? 'ivory';
}

/** « Ce qui est inclus » lu en base : listes vides si la valeur est inattendue. */
export function parseRangeIncluded(value: unknown): RangeIncluded {
  const parsed = rangeIncludedSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_RANGE_INCLUDED;
}
