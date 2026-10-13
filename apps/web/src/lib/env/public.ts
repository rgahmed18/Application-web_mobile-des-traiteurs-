import { z } from 'zod';

/**
 * Variables publiques (visibles du navigateur), lues AU DÉMARRAGE du serveur et non au build :
 * une même image sert le staging et la production. Le serveur les lit dans son environnement
 * (PUBLIC_API_URL, PUBLIC_MEDIA_URL — volontairement sans préfixe NEXT_PUBLIC_, que Next
 * remplacerait au build) ; le layout racine les publie dans la page (window.__PUBLIC_ENV__)
 * avant le code applicatif. Ces valeurs sont publiques : n'y mettez jamais de secret.
 */
export const publicEnvSchema = z.object({
  /** URL de l'API appelée directement par le navigateur (données du back-office). */
  PUBLIC_API_URL: z.url().default('http://localhost:3000/api/v1'),
  /** Base publique des photos (bucket media / CDN), ex. http://localhost:9000/traiteur-media */
  PUBLIC_MEDIA_URL: z.url().default('http://localhost:9000/traiteur-media'),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

declare global {
  interface Window {
    __PUBLIC_ENV__?: PublicEnv;
  }
}

/** Côté serveur : variables lues dans l'environnement du processus (au démarrage). */
export function serverPublicEnv(source: NodeJS.ProcessEnv = process.env): PublicEnv {
  const result = publicEnvSchema.safeParse({
    PUBLIC_API_URL: source.PUBLIC_API_URL,
    PUBLIC_MEDIA_URL: source.PUBLIC_MEDIA_URL,
  });
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Variables publiques invalides (web) :\n${details.join('\n')}`);
  }
  return result.data;
}

/** Script inséré dans la page : JSON échappé (aucune balise ne peut en sortir). */
export function publicEnvScript(env: PublicEnv): string {
  return `window.__PUBLIC_ENV__=${JSON.stringify(env).replace(/</g, '\\u003c')};`;
}

/** Variables publiques, dans le navigateur (publiées par la page) comme sur le serveur. */
export function publicEnv(): PublicEnv {
  if (typeof window === 'undefined') return serverPublicEnv();
  const published = window.__PUBLIC_ENV__;
  if (!published) throw new Error('Variables publiques absentes de la page (layout racine)');
  return published;
}
