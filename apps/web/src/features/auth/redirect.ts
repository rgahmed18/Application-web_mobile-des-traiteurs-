/** Pages de connexion du back-office. */
export const LOGIN_PATH = '/admin/login';
export const HOME_PATH = '/admin';
/** Console de la plateforme (SUPER_ADMIN). */
export const PLATFORM_HOME_PATH = '/platform';

/**
 * Destination après connexion (« ?next=/admin/catalog »), limitée au back-office et à la
 * console : empêche une redirection ouverte vers un site tiers (« ?next=https://… » ou « //… »).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (
    !next ||
    !(next.startsWith('/admin') || next.startsWith(PLATFORM_HOME_PATH)) ||
    next.startsWith('//') ||
    next.includes('\\')
  ) {
    return HOME_PATH;
  }
  return next.startsWith(LOGIN_PATH) ? HOME_PATH : next;
}

/**
 * Où aller une fois connecté : le super admin (session plateforme) arrive toujours sur la
 * console, jamais dans le back-office d'un traiteur ; les autres comptes jamais dans la console.
 */
export function destinationFor(next: string, platform: boolean): string {
  const toPlatform = next.startsWith(PLATFORM_HOME_PATH);
  if (platform) return toPlatform ? next : PLATFORM_HOME_PATH;
  return toPlatform ? HOME_PATH : next;
}
