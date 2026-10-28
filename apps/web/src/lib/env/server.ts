import 'server-only';

import { z } from 'zod';

/**
 * Variables d'environnement lues uniquement côté serveur (routes /api/session).
 * Validées au premier accès : une configuration invalide échoue immédiatement.
 */
const serverEnvSchema = z.object({
  /** URL de l'API vue depuis le serveur Next (réseau interne en production). */
  API_INTERNAL_URL: z.url().default('http://localhost:3000/api/v1'),
  /**
   * Démonstration : sur l'adresse de la console, « ?traiteur=<identifiant> » ou une liste de
   * choix désignent le traiteur. Désactivé par défaut et refusé en production : le traiteur vient
   * alors toujours de l'adresse (sous-domaine ou domaine personnalisé).
   */
  DEMO_SPACE_SELECTION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Durée de vie du cookie de session, alignée sur REFRESH_TOKEN_TTL_DAYS de l'API. */
  REFRESH_COOKIE_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * Nombre de proxys de confiance devant Next (Nginx = 1, Cloudflare + Nginx = 2). Détermine
   * quelle adresse de X-Forwarded-For est l'IP réelle du navigateur ; 0 : aucune n'est lue.
   */
  WEB_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  /** Cookie « Secure » : à désactiver uniquement pour un navigateur qui le refuse en http local. */
  REFRESH_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Variables d'environnement invalides (web) :\n${details.join('\n')}`);
  }
  if (process.env.NODE_ENV === 'production' && result.data.DEMO_SPACE_SELECTION) {
    throw new Error(
      "Variables d'environnement invalides (web) :\nDEMO_SPACE_SELECTION: interdit en production (le traiteur vient de l'adresse).",
    );
  }
  cached = result.data;
  if (process.env.NODE_ENV === 'production' && cached.WEB_TRUSTED_PROXY_HOPS === 0) {
    // Sans proxy déclaré, aucune IP n'est transmise : l'API voit tous les navigateurs avec
    // l'adresse du serveur Next et leur applique les mêmes quotas par IP.
    console.warn(
      "WEB_TRUSTED_PROXY_HOPS=0 en production : l'IP des navigateurs n'est pas transmise à l'API (voir README).",
    );
  }
  return cached;
}
