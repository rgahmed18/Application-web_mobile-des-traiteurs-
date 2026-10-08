import { isIP } from 'node:net';

/**
 * IP du navigateur à transmettre à l'API (limitation de débit, quotas SMS, journal d'audit).
 *
 * X-Forwarded-For est une liste « client, proxy1, proxy2… » : chaque proxy AJOUTE à droite
 * l'adresse de la connexion qu'il reçoit. Seules les entrées ajoutées par nos propres proxys
 * sont fiables ; tout ce qui est à leur gauche a pu être écrit par le client.
 *
 * - trustedProxyHops = 0 (aucun proxy devant Next) : l'en-tête vient forcément du navigateur
 *   (Next ne le complète que s'il est absent, sans ajouter l'adresse du socket, et ne donne pas
 *   accès au socket aux routes) : on n'en tient aucun compte et aucune IP n'est transmise.
 * - trustedProxyHops = N : on retient la N-ième adresse en partant de la droite, celle ajoutée
 *   par le proxy le plus externe (le premier à recevoir la connexion du navigateur).
 *
 * X-Real-IP n'est jamais lu : il ne s'ajoute pas, un client peut donc l'envoyer tel quel.
 * Une liste trop courte (accès direct qui contourne le proxy) ou une adresse invalide donne null.
 */
export function clientIpFromHeaders(headers: Headers, trustedProxyHops: number): string | null {
  if (trustedProxyHops <= 0) return null;
  const header = headers.get('x-forwarded-for');
  if (!header) return null;
  const entries = header.split(',').map((entry) => entry.trim());
  const candidate = entries[entries.length - trustedProxyHops];
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}
