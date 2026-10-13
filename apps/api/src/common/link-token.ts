import { createHash, randomBytes } from 'node:crypto';

/**
 * Jeton d'un lien sécurisé (devis, invitation) : 256 bits aléatoires, affiché une seule fois ;
 * seule son empreinte SHA-256 est conservée en base.
 */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Forme d'un jeton émis par newLinkToken (43 caractères base64url) : refus immédiat sinon. */
export function isLinkTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
