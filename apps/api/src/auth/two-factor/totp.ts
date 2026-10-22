import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Codes à usage unique basés sur le temps (TOTP, RFC 6238) : HMAC-SHA1, pas de 30 secondes,
 * 6 chiffres — les réglages par défaut de Google Authenticator, Microsoft Authenticator,
 * Aegis, 1Password…
 */
export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Tolérance d'un pas avant ou après : horloge du téléphone décalée de 30 s au plus. */
const WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Clé base32 invalide');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Nouveau secret : 160 bits aléatoires, en base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Numéro du pas de temps (30 s) d'un instant. */
export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/** Code à 6 chiffres d'un pas de temps (RFC 4226, troncature dynamique). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Pas de temps du code s'il est valide (pas courant ± 1) et postérieur au dernier code accepté
 * (un code déjà utilisé est refusé, même encore dans sa fenêtre) ; null sinon.
 */
export function verifyTotp(
  secret: string,
  code: string,
  now: Date,
  lastAcceptedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  for (let delta = -WINDOW; delta <= WINDOW; delta += 1) {
    const step = current + delta;
    if (lastAcceptedStep !== null && step <= lastAcceptedStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** Lien otpauth:// lu par les applications (QR code). */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
