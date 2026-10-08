import { z } from 'zod';

const SEPARATORS = /[\s.\-()]/g;
const E164 = /^\+[1-9]\d{7,14}$/;
const MOROCCAN_NATIONAL = /^0([5-7]\d{8})$/;

/**
 * Normalise un numéro de téléphone au format E.164.
 * Accepte les formats marocains usuels : 0612345678, +212612345678, 00212612345678,
 * 212612345678, ainsi que tout numéro international déjà au format +XXXXXXXX.
 * Retourne null si le numéro est invalide.
 */
export function normalizePhone(input: string): string | null {
  let value = input.replace(SEPARATORS, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (/^212[5-7]\d{8}$/.test(value)) value = `+${value}`;

  const national = MOROCCAN_NATIONAL.exec(value);
  if (national) value = `+212${national[1]}`;

  // +212 0612345678 → +212612345678 (zéro national saisi par erreur)
  value = value.replace(/^\+2120([5-7]\d{8})$/, '+212$1');

  if (value.startsWith('+212') && !/^\+212[5-7]\d{8}$/.test(value)) return null;
  return E164.test(value) ? value : null;
}

/** Schéma Zod : valide et normalise un numéro en E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Numéro de téléphone requis')
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Numéro de téléphone invalide' });
      return z.NEVER;
    }
    return normalized;
  });

/** Masque un numéro pour les journaux : +212612345678 → +2126****5678 */
export function maskPhone(phone: string): string {
  if (phone.length <= 8) return '****';
  return `${phone.slice(0, 5)}****${phone.slice(-4)}`;
}
