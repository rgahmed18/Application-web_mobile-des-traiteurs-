import { z } from 'zod';

/**
 * Activation d'un compte de la plateforme (SUPER_ADMIN) créé par la commande serveur
 * « super-admin create » : lien à usage unique, valable 24 heures, pour choisir son mot de passe.
 * La double authentification est ensuite imposée à la première connexion.
 */
export const ACTIVATION_TTL_HOURS = 24;

export const publicActivationSchema = z.object({
  firstName: z.string(),
  /** Téléphone masqué (« +212 6•• ••• •12 ») : l'identifiant de connexion, sans le dévoiler. */
  phone: z.string(),
  expiresAt: z.iso.datetime(),
});
export type PublicActivation = z.infer<typeof publicActivationSchema>;

export const activationAcceptSchema = z.object({ password: z.string().min(1).max(128) });
export type ActivationAcceptInput = z.infer<typeof activationAcceptSchema>;

export const activationAcceptResultSchema = z.object({
  /** Identifiant de connexion à préremplir. */
  phone: z.string(),
});
export type ActivationAcceptResult = z.infer<typeof activationAcceptResultSchema>;
