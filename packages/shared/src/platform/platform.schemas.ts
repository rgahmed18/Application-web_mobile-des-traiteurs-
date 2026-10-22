import { z } from 'zod';

import { subscriptionPlanSchema } from '../enums';

/**
 * Console de la plateforme (SUPER_ADMIN) : uniquement des chiffres agrégés, jamais le détail des
 * données des clients d'un traiteur (il faut entrer explicitement chez lui pour les voir).
 */

export const TRAITEUR_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED'] as const;
export const traiteurStatusSchema = z.enum(TRAITEUR_STATUSES);
export type TraiteurStatus = z.infer<typeof traiteurStatusSchema>;

/** Durée d'essai par défaut d'un nouveau traiteur (modifiable traiteur par traiteur). */
export const DEFAULT_TRIAL_DAYS = 30;
/** Essais affichés sur le tableau de bord : fin dans les 14 jours. */
export const TRIAL_ENDING_SOON_DAYS = 14;

const planSchema = subscriptionPlanSchema;

export const platformDashboardSchema = z.object({
  traiteurs: z.object({
    active: z.number().int(),
    trial: z.number().int(),
    suspended: z.number().int(),
    cancelled: z.number().int(),
  }),
  /** Commandes créées ce mois-ci (tous traiteurs confondus) et le mois précédent. */
  ordersThisMonth: z.number().int(),
  ordersLastMonth: z.number().int(),
  /** Abonnements estimés : prix en vigueur de l'offre de chaque traiteur actif (centimes). */
  estimatedMonthlyRevenue: z.number().int(),
  currency: z.string(),
  /** Prix mensuel en vigueur de chaque offre (centimes). */
  planPrices: z.record(planSchema, z.number().int()),
  trialsEndingSoon: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      city: z.string().nullable(),
      plan: planSchema,
      trialEndsAt: z.iso.datetime(),
      daysLeft: z.number().int(),
    }),
  ),
  /** Traiteurs les plus actifs du mois : identité, offre, statut et nombre de commandes. */
  traiteurActivity: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      city: z.string().nullable(),
      plan: planSchema,
      status: traiteurStatusSchema,
      ordersThisMonth: z.number().int(),
    }),
  ),
  /** Dernières actions de la plateforme (journal d'audit, sans données de clients). */
  recentActions: z.array(
    z.object({
      id: z.uuid(),
      at: z.iso.datetime(),
      action: z.string(),
      traiteurName: z.string().nullable(),
      actorName: z.string().nullable(),
    }),
  ),
});
export type PlatformDashboard = z.infer<typeof platformDashboardSchema>;
