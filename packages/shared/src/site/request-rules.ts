import { z } from 'zod';

import { addDays, localDateSchema } from '../time/zoned';

/**
 * Règles des demandes en ligne, réglées par chaque traiteur (Paramètres → Site client) et
 * appliquées à l'identique par le site (interface) et par l'API (validation) :
 *   - nombre d'invités de `minGuests` à `maxGuests` (défaut 10 à 5 000) ;
 *   - délai minimum de `leadDays` jours avant l'événement (défaut 3) : la première date possible
 *     est aujourd'hui + `leadDays`, jour civil du traiteur.
 * Les limites propres à un menu (ex. 80 à 600 invités) restent un simple avertissement.
 */
export const REQUEST_GUESTS_CEILING = 5000;
export const REQUEST_LEAD_DAYS_MAX = 365;

export const requestRulesSchema = z.object({
  minGuests: z.number().int().min(1).max(REQUEST_GUESTS_CEILING),
  maxGuests: z.number().int().min(1).max(REQUEST_GUESTS_CEILING),
  leadDays: z.number().int().min(1).max(REQUEST_LEAD_DAYS_MAX),
});
export type RequestRules = z.infer<typeof requestRulesSchema>;

export const DEFAULT_REQUEST_RULES: RequestRules = { minGuests: 10, maxGuests: 5000, leadDays: 3 };

/** Nombre d'invités hors des règles du traiteur : sous le minimum, au-dessus du maximum. */
export function guestsRuleError(
  guests: number,
  rules: Pick<RequestRules, 'minGuests' | 'maxGuests'>,
): 'belowMinimum' | 'aboveMaximum' | null {
  if (guests < rules.minGuests) return 'belowMinimum';
  if (guests > rules.maxGuests) return 'aboveMaximum';
  return null;
}

/** Première date d'événement acceptée (jour civil du traiteur). */
export function earliestEventDate(today: string, leadDays: number): string {
  return addDays(today, leadDays);
}

/** Calendrier du sélecteur de date : jours impossibles, sans aucun chiffre (capacité). */
export const clientCalendarQuerySchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
});
export type ClientCalendarQuery = z.infer<typeof clientCalendarQuerySchema>;

export const clientCalendarSchema = z.object({
  /** Première date possible (aujourd'hui + délai minimum du traiteur). */
  earliest: localDateSchema,
  /** Jours fermés : fermeture hebdomadaire ou date bloquée. */
  closed: z.array(localDateSchema),
  /** Jours complets : capacité du jour atteinte. */
  full: z.array(localDateSchema),
});
export type ClientCalendar = z.infer<typeof clientCalendarSchema>;
