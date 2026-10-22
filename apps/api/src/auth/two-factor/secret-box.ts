import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Chiffrement des secrets de double authentification en base (AES-256-GCM). Un vol de la base
 * seule ne permet pas de générer les codes : la clé (TWO_FACTOR_ENCRYPTION_KEY) n'est que dans
 * la configuration du serveur. Format : « v1:iv:tag:données », en base64url.
 */
const VERSION = 'v1';

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(`two-factor:${secret}`).digest();
}

export function sealSecret(plain: string, encryptionKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(encryptionKey), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join(':');
}

export function openSecret(sealed: string, encryptionKey: string): string {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Secret chiffré illisible');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFrom(encryptionKey),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
