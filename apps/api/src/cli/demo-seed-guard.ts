/**
 * Garde du seed de démonstration (clients et commandes fictifs, comptes au mot de passe
 * connu « Password123! ») : il ne doit JAMAIS tourner en production.
 *
 * Environnement lu dans APP_ENV, à défaut ENVIRONMENT (le .env des serveurs), à défaut
 * SENTRY_ENVIRONMENT :
 *   - production : toujours refusé, aucune variable ne peut l'autoriser ;
 *   - staging : refusé, sauf opt-in dédié ALLOW_STAGING_DEMO_SEED=true ; les comptes de
 *     démonstration y prennent alors le mot de passe DEMO_SEED_PASSWORD (propre au serveur,
 *     12 caractères au moins, jamais « Password123! ») et aucun super admin n'est créé ;
 *   - NODE_ENV=production sans environnement staging déclaré : refusé (serveur inconnu) ;
 *   - développement et tests : autorisé, mot de passe de démonstration habituel.
 * Le super admin d'un serveur se crée uniquement avec `super-admin create` (mot de passe
 * choisi par la personne, via le lien d'activation).
 */
export const LOCAL_DEMO_PASSWORD = 'Password123!';

export interface DemoSeedPlan {
  /** Mot de passe des comptes de démonstration. */
  password: string;
  /** Compte super admin de démonstration (développement seulement). */
  withSuperAdmin: boolean;
}

export class DemoSeedRefused extends Error {
  constructor(reason: string) {
    super(`Seed de démonstration refusé : ${reason}`);
    this.name = 'DemoSeedRefused';
  }
}

type Env = Record<string, string | undefined>;

/** Environnement déclaré du serveur (minuscules), ou null s'il n'y en a pas. */
export function declaredEnvironment(env: Env): string | null {
  const value = env.APP_ENV ?? env.ENVIRONMENT ?? env.SENTRY_ENVIRONMENT;
  return value ? value.trim().toLowerCase() : null;
}

/** Plan du seed, ou refus explicite (exception) selon l'environnement. */
export function demoSeedPlan(env: Env): DemoSeedPlan {
  const environment = declaredEnvironment(env);
  if (environment === 'production' || environment === 'prod') {
    throw new DemoSeedRefused('environnement de production (aucune exception possible).');
  }
  if (environment === 'staging') {
    if (env.ALLOW_STAGING_DEMO_SEED !== 'true') {
      throw new DemoSeedRefused(
        'staging sans opt-in (ALLOW_STAGING_DEMO_SEED=true pour des données fictives).',
      );
    }
    const password = env.DEMO_SEED_PASSWORD ?? '';
    if (password.length < 12 || password === LOCAL_DEMO_PASSWORD) {
      throw new DemoSeedRefused(
        'DEMO_SEED_PASSWORD manquant ou trop faible en staging (12 caractères au moins, propre au serveur).',
      );
    }
    return { password, withSuperAdmin: false };
  }
  if (env.NODE_ENV === 'production') {
    throw new DemoSeedRefused(
      'NODE_ENV=production sans environnement staging déclaré (APP_ENV ou ENVIRONMENT).',
    );
  }
  return { password: LOCAL_DEMO_PASSWORD, withSuperAdmin: true };
}
