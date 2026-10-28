/**
 * Origines autorisées à appeler l'API depuis un navigateur. Chaque entrée de CORS_ORIGINS est
 * une origine exacte (« https://console.exemple.ma ») ou un modèle à un seul niveau de
 * sous-domaine (« http://*.192.168.1.8.nip.io:3001 ») : le back-office de chaque traiteur est
 * servi sur son propre sous-domaine. En production, le navigateur appelle l'API sur sa propre
 * adresse (/api/v1 derrière Caddy) : aucune origine croisée n'est nécessaire.
 */
export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    if (!entry.includes('*')) return entry === origin;
    const match = /^(https?):\/\/\*\.([^/]+)$/.exec(entry);
    const [, scheme, rest] = match ?? [];
    if (!scheme || !rest) return false;
    const prefix = `${scheme}://`;
    if (!origin.startsWith(prefix) || !origin.endsWith(`.${rest}`)) return false;
    const label = origin.slice(prefix.length, origin.length - rest.length - 1);
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
  });
}

/** Option « origin » de app.enableCors. */
export function corsOrigin(allowed: readonly string[]) {
  return (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ): void => {
    // Sans en-tête Origin (applications mobiles, serveur web, curl) : pas de CORS en jeu
    callback(null, origin === undefined || isAllowedOrigin(origin, allowed));
  };
}
