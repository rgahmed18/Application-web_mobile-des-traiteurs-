/**
 * Nombre d'invités du site client : un seul pour toute la demande (comparateur, fiches,
 * « Ma demande », envoi au traiteur). Nombre entier de 1 à 5 000.
 */
export const GUESTS_MIN = 1;
export const GUESTS_MAX = 5000;

export type GuestsError = 'notInteger' | 'outOfRange';

/** Saisie du nombre d'invités : vide (null), valeur valide ou erreur à montrer. */
export function parseGuests(text: string): { value: number | null; error: GuestsError | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null, error: null };
  if (!/^\d+$/.test(trimmed)) return { value: null, error: 'notInteger' };
  const value = Number(trimmed);
  if (value < GUESTS_MIN || value > GUESTS_MAX) return { value: null, error: 'outOfRange' };
  return { value, error: null };
}

/** Nombre borné (boutons − / +). */
export function clampGuests(value: number): number {
  return Math.min(GUESTS_MAX, Math.max(GUESTS_MIN, Math.round(value)));
}

/** Nombre lu en stockage : valide, sinon null. */
export function storedGuests(raw: string | null): number | null {
  return raw === null ? null : parseGuests(raw).value;
}
