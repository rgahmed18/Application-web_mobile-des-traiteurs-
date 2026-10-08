/** Pages de connexion du back-office. */
export const LOGIN_PATH = '/admin/login';
export const HOME_PATH = '/admin';

/**
 * Destination après connexion (« ?next=/admin/catalog »), limitée au back-office :
 * empêche une redirection ouverte vers un site tiers (« ?next=https://… » ou « //… »).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/admin') || next.startsWith('//') || next.includes('\\')) {
    return HOME_PATH;
  }
  return next.startsWith(LOGIN_PATH) ? HOME_PATH : next;
}
