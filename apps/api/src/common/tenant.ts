import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from './errors';

/** Traiteur de l'opération : toujours celui du jeton, jamais une donnée envoyée par le client. */
export function requireTraiteurId(user: AuthenticatedUser): string {
  if (!user.traiteurId) {
    throw appErrors.forbidden('TRAITEUR_REQUIRED', 'Aucun traiteur actif dans la session');
  }
  return user.traiteurId;
}
