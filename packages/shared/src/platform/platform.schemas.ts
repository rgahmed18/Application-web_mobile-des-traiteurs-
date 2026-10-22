import { z } from 'zod';

import { phoneSchema } from '../auth/phone';
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

// ─────────────────────────── Traiteurs ───────────────────────────

/** Identifiant d'URL d'un traiteur : « dar-diafa ». */
export const traiteurSlugInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lettres minuscules, chiffres et tirets (ex. dar-diafa)')
  .min(3)
  .max(60);

export const platformTraiteurListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: traiteurStatusSchema.optional(),
  plan: subscriptionPlanSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PlatformTraiteurListQuery = z.infer<typeof platformTraiteurListQuerySchema>;

/** Premier administrateur : identité et état de son accès (jamais de donnée de client). */
export const platformTraiteurAdminSchema = z.object({
  membershipId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']),
  /** Lien d'activation en cours (statut INVITED). */
  invitationExpiresAt: z.iso.datetime().nullable(),
});

export const platformTraiteurSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  email: z.string(),
  phone: z.string(),
  plan: subscriptionPlanSchema,
  status: traiteurStatusSchema,
  trialEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  ordersThisMonth: z.number().int(),
  admin: platformTraiteurAdminSchema.nullable(),
});
export type PlatformTraiteur = z.infer<typeof platformTraiteurSchema>;

export const platformTraiteurPageSchema = z.object({
  items: z.array(platformTraiteurSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type PlatformTraiteurPage = z.infer<typeof platformTraiteurPageSchema>;

/** Création d'un traiteur depuis la console : en essai (30 jours par défaut). */
export const platformTraiteurCreateSchema = z.object({
  slug: traiteurSlugInputSchema,
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.toLowerCase()),
  phone: phoneSchema,
  city: z.string().trim().min(2).max(80),
  plan: subscriptionPlanSchema,
  locale: z.enum(['fr', 'ar']),
  /** Durée de l'essai en jours (0 : actif d'emblée, sans essai). */
  trialDays: z.number().int().min(0).max(365),
  admin: z.object({
    phone: phoneSchema,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
  }),
});
export type PlatformTraiteurCreateInput = z.infer<typeof platformTraiteurCreateSchema>;

/** Lien d'activation de l'administrateur : affiché une fois (copie, WhatsApp), SMS si possible. */
export const platformInvitationLinkSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
  smsSent: z.boolean(),
});

export const platformTraiteurCreateResultSchema = z.object({
  traiteur: platformTraiteurSchema,
  link: platformInvitationLinkSchema,
});
export type PlatformTraiteurCreateResult = z.infer<typeof platformTraiteurCreateResultSchema>;
