import { z } from 'zod';

import { traiteurStatusSchema } from '../platform/platform.schemas';

/**
 * Espace servi par une adresse : la console de la plateforme, ou le back-office d'un traiteur
 * (sous-domaine « <identifiant>.<domaine> », ou domaine personnalisé vérifié). Le traiteur est
 * TOUJOURS déduit de l'adresse par le serveur, jamais choisi par le navigateur.
 */
export const spaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('platform') }),
  z.object({
    kind: z.literal('traiteur'),
    traiteur: z.object({
      id: z.uuid(),
      slug: z.string(),
      name: z.string(),
      logoUrl: z.string().nullable(),
      status: traiteurStatusSchema,
    }),
  }),
]);
export type Space = z.infer<typeof spaceSchema>;

export const spaceResolveQuerySchema = z.object({
  host: z.string().trim().min(1).max(260),
});

/** Démonstration uniquement : traiteurs proposés au choix sur la page de connexion. */
export const demoSpacesSchema = z.object({
  traiteurs: z.array(z.object({ slug: z.string(), name: z.string() })),
});
export type DemoSpaces = z.infer<typeof demoSpacesSchema>;
