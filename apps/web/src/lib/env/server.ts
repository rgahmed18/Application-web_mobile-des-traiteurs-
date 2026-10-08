import 'server-only';

import { z } from 'zod';

/**
 * Variables d'environnement lues uniquement côté serveur (routes /api/session).
 * Validées au premier accès : une configuration invalide échoue immédiatement.
 */
const serverEnvSchema = z.object({
  /** URL de l'API vue depuis le serveur Next (réseau interne en production). */
  API_INTERNAL_URL: z.url().default('http://localhost:3000/api/v1'),
  /** Établissement auquel ce back-office est rattaché (détection par domaine plus tard). */
  TRAITEUR_SLUG: z.string().min(1).default('dar-diafa'),
  /** Durée de vie du cookie de session, alignée sur REFRESH_TOKEN_TTL_DAYS de l'API. */
  REFRESH_COOKIE_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
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
  cached = result.data;
  return cached;
}
