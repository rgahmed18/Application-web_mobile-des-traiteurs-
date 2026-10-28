/**
 * Lecture d'une adresse (en-tête Host) : console de la plateforme, sous-domaine d'un traiteur,
 * ou autre domaine (domaine personnalisé à chercher en base). Fonctions pures, partagées par
 * l'API (résolution, certificats HTTPS) et le serveur web.
 */

/** Sous-domaines jamais attribués à un traiteur. */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'app',
  'admin',
  'console',
  'platform',
  'plateforme',
  'media',
  'static',
  'assets',
  'cdn',
  'mail',
  'smtp',
  'status',
  'staging',
  'docs',
]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * « Dar-Diafa.Exemple.ma:443 » → « dar-diafa.exemple.ma ». Retire le port et le point final ;
 * null si ce n'est pas un nom d'hôte valide (caractères, longueur, IPv6).
 */
export function normalizeHostname(host: string | null | undefined): string | null {
  if (!host) return null;
  let value = host.trim().toLowerCase();
  if (value.startsWith('[')) return null; // IPv6 littérale : jamais un espace
  value = value.replace(/:\d{1,5}$/, '').replace(/\.$/, '');
  if (value.length === 0 || value.length > 253) return null;
  return value.split('.').every((label) => LABEL.test(label)) ? value : null;
}

export interface SpaceHostConfig {
  /** Domaine des traiteurs : « <identifiant>.<baseDomain> ». */
  baseDomain: string;
  /** Adresses de la console de la plateforme (sans port). */
  platformHostnames: readonly string[];
}

export type HostKind =
  { kind: 'platform' } | { kind: 'subdomain'; slug: string } | { kind: 'custom'; hostname: string };

/** Nature d'une adresse ; null si elle ne peut servir aucun espace. */
export function classifyHost(
  host: string | null | undefined,
  config: SpaceHostConfig,
): HostKind | null {
  const hostname = normalizeHostname(host);
  if (!hostname) return null;
  const base = normalizeHostname(config.baseDomain);
  if (config.platformHostnames.some((platform) => normalizeHostname(platform) === hostname)) {
    return { kind: 'platform' };
  }
  if (base && hostname.endsWith(`.${base}`)) {
    const slug = hostname.slice(0, -(base.length + 1));
    // Un seul niveau : « a.b.<domaine> » n'est jamais un traiteur
    if (slug.includes('.') || RESERVED_SUBDOMAINS.has(slug)) return null;
    return { kind: 'subdomain', slug };
  }
  if (base && hostname === base) return null;
  // Adresse IP ou nom sans point : jamais un domaine personnalisé
  if (!hostname.includes('.') || /^\d+(\.\d+){3}$/.test(hostname)) return null;
  return { kind: 'custom', hostname };
}
