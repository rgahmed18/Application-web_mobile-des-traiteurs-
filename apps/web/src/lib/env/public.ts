import { z } from 'zod';

/**
 * Variables publiques (NEXT_PUBLIC_*), incluses dans le code du navigateur.
 * Next remplace chaque accès littéral process.env.NEXT_PUBLIC_X au moment du build.
 */
const publicEnvSchema = z.object({
  /** URL de l'API appelée directement par le navigateur (données du back-office). */
  NEXT_PUBLIC_API_URL: z.url().default('http://localhost:3000/api/v1'),
  /** Base publique des photos (bucket S3 / CDN), ex. http://localhost:9000/traiteur-media */
  NEXT_PUBLIC_MEDIA_URL: z.url().default('http://localhost:9000/traiteur-media'),
});

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_MEDIA_URL: process.env.NEXT_PUBLIC_MEDIA_URL,
});
