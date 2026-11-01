/**
 * Onglet qui se réveille (de nouveau visible, focus, page restaurée depuis le cache de
 * navigation) : Chrome gèle les onglets en arrière-plan et la page restaurée depuis le cache
 * n'a reçu aucun message ; la fin de session faite ailleurs a pu lui échapper.
 *
 * Repère de session : cookie LISIBLE posé par le proxy de session (identifiant aléatoire, sans
 * aucun secret : le refresh token reste dans son cookie httpOnly), conservé aux rotations,
 * effacé à la déconnexion et remplacé à chaque nouvelle connexion. Repère absent ou différent de
 * celui de la session de l'onglet : cette session est terminée, sans requête.
 */
export const SESSION_MARK_COOKIE = 'gt_session_mark';

/** Absence au-delà de laquelle la session est revérifiée auprès du serveur avant affichage. */
export const WAKE_VERIFY_AFTER_MS = 60_000;

export function readSessionMark(cookies: string): string | null {
  for (const part of cookies.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_MARK_COOKIE) return value.join('=') || null;
  }
  return null;
}

/**
 * - « ended » : session terminée ailleurs (repère effacé ou remplacé) ;
 * - « verify » : longue absence ou page restaurée : vérification auprès du serveur (expiration,
 *   révocation, suspension), contenu masqué en attendant ;
 * - « none » : rien à faire.
 */
export type WakeAction = 'none' | 'ended' | 'verify';

export function wakeAction(input: {
  authenticated: boolean;
  /** Repère vu à l'ouverture de la session de l'onglet (null : inconnu, session plus ancienne). */
  sessionMark: string | null;
  currentMark: string | null;
  hiddenForMs: number;
  restoredFromCache: boolean;
}): WakeAction {
  if (!input.authenticated) return 'none';
  if (input.sessionMark !== null && input.currentMark !== input.sessionMark) return 'ended';
  if (input.restoredFromCache || input.hiddenForMs >= WAKE_VERIFY_AFTER_MS) return 'verify';
  return 'none';
}
