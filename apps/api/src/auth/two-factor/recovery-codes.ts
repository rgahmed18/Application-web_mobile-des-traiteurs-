import { createHash, randomInt } from 'node:crypto';

import { RECOVERY_CODE_COUNT } from '@traiteur/shared';

/** Sans caractères ambigus (0/O, 1/I/L) : les codes se recopient à la main sans erreur. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Codes de secours « ABCD-EFGH » (≈ 40 bits chacun), affichés une seule fois. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = '';
    for (let index = 0; index < 8; index += 1) raw += ALPHABET[randomInt(ALPHABET.length)];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...codes];
}

/** Forme comparable : majuscules, sans tiret ni espace. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(`recovery:${normalizeRecoveryCode(code)}`)
    .digest('hex');
}

export function isRecoveryCodeShape(code: string): boolean {
  return /^[A-Z0-9]{8}$/.test(normalizeRecoveryCode(code));
}
