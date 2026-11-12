/** Page de connexion et espace du client sur le site du traiteur. */
export const SITE_LOGIN_PATH = '/connexion';
export const SITE_ACCOUNT_PATH = '/espace';

/** Pages du site où revenir après la connexion (jamais le back-office ni un site tiers). */
const SITE_PREFIXES = ['/espace', '/demande', '/catalogue'];

/** Destination après connexion (« ?suite=/demande ») ; sinon l'espace du client. */
export function siteNextPath(next: string | null | undefined): string {
  if (!next || next.startsWith('//') || next.includes('\\') || next.includes('://')) {
    return SITE_ACCOUNT_PATH;
  }
  const allowed = next === '/' || SITE_PREFIXES.some((prefix) => next.startsWith(prefix));
  return allowed ? next : SITE_ACCOUNT_PATH;
}

/** Adresse de connexion qui ramène ensuite sur la page demandée. */
export function siteLoginHref(next: string): string {
  return `${SITE_LOGIN_PATH}?suite=${encodeURIComponent(next)}`;
}
