import { z } from 'zod';

import { FEATURE_KEYS } from '../access/features';
import { phoneSchema } from '../auth/phone';
import { roleSchema, subscriptionPlanSchema, TENANT_ROLES, tenantRoleSchema } from '../enums';
import { localDateSchema } from '../time/zoned';

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

// ─────────────────────────── Fiche d'un traiteur ───────────────────────────

export const featureKeySchema = z.enum(FEATURE_KEYS);

export const platformTraiteurDetailSchema = platformTraiteurSchema.extend({
  suspendedAt: z.iso.datetime().nullable(),
  suspensionReason: z.string().nullable(),
  features: z.array(
    z.object({
      key: featureKeySchema,
      enabled: z.boolean(),
      /** Incluse par défaut dans l'offre actuelle du traiteur. */
      includedInPlan: z.boolean(),
    }),
  ),
  /** Actions de la plateforme sur ce traiteur (offre, fonctionnalités, suspension…). */
  history: z.array(
    z.object({
      id: z.uuid(),
      at: z.iso.datetime(),
      action: z.string(),
      actorName: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
});
export type PlatformTraiteurDetail = z.infer<typeof platformTraiteurDetailSchema>;

export const platformPlanChangeSchema = z.object({
  plan: subscriptionPlanSchema,
  /** Remet les fonctionnalités à celles de la nouvelle offre (sinon, elles sont conservées). */
  applyPlanFeatures: z.boolean(),
});
export type PlatformPlanChangeInput = z.infer<typeof platformPlanChangeSchema>;

export const platformFeatureToggleSchema = z.object({ enabled: z.boolean() });
export type PlatformFeatureToggleInput = z.infer<typeof platformFeatureToggleSchema>;

export const platformSuspendSchema = z.object({
  reason: z.string().trim().min(3, 'Motif obligatoire').max(500),
});
export type PlatformSuspendInput = z.infer<typeof platformSuspendSchema>;

/** Fin de l'essai (jour, fuseau du Maroc) : prolonger ou raccourcir. */
export const platformTrialUpdateSchema = z.object({ trialEndsOn: localDateSchema });
export type PlatformTrialUpdateInput = z.infer<typeof platformTrialUpdateSchema>;

// ─────────────────────────── Offres ───────────────────────────

export const platformPlansSchema = z.object({
  currency: z.string(),
  plans: z.array(
    z.object({
      plan: subscriptionPlanSchema,
      /** Prix mensuel en vigueur (centimes, TTC). */
      monthlyPrice: z.number().int(),
      features: z.array(featureKeySchema),
      /** Traiteurs actifs ou en essai sur cette offre. */
      traiteurs: z.number().int(),
      history: z.array(
        z.object({
          monthlyPrice: z.number().int(),
          effectiveFrom: z.iso.datetime(),
          createdBy: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type PlatformPlans = z.infer<typeof platformPlansSchema>;

export const platformPlanPriceSchema = z.object({
  monthlyPrice: z.number().int().min(0).max(100_000_000),
});
export type PlatformPlanPriceInput = z.infer<typeof platformPlanPriceSchema>;

// ─────────────────────────── Entrer chez un traiteur ───────────────────────────

/** Durée d'un accès chez un traiteur (prolongeable avec un nouveau motif). */
export const PLATFORM_ACCESS_HOURS = 2;

export const platformAccessReasonSchema = z.object({
  reason: z.string().trim().min(3, 'Motif obligatoire').max(300),
});
export type PlatformAccessReasonInput = z.infer<typeof platformAccessReasonSchema>;

export const platformAccessSchema = z.object({
  id: z.uuid(),
  traiteurName: z.string(),
  reason: z.string(),
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type PlatformAccess = z.infer<typeof platformAccessSchema>;

// ─────────────────────────── Journal d'audit ───────────────────────────

/**
 * Journal d'audit de la console. Portée « platform » (par défaut) : actions des super admins, des
 * commandes serveur et de la console ; « all » : toutes les actions, y compris celles des équipes
 * des traiteurs (sans leur contenu : ni avant/après, ni nom d'un client).
 */
export const PLATFORM_AUDIT_SCOPES = ['platform', 'all'] as const;

export const platformAuditQuerySchema = z
  .object({
    scope: z.enum(PLATFORM_AUDIT_SCOPES).default('platform'),
    actorUserId: z.uuid().optional(),
    action: z
      .string()
      .trim()
      .regex(/^[a-z0-9_.]{1,80}$/)
      .optional(),
    traiteurId: z.uuid().optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'Période invalide',
    path: ['to'],
  });
export type PlatformAuditQuery = z.infer<typeof platformAuditQuerySchema>;

export const platformAuditEntrySchema = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  action: z.string(),
  traiteur: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** Auteur : nom masqué pour un client (seul son rôle est indiqué) ; null : action système. */
  actor: z.object({ name: z.string().nullable(), role: roleSchema.nullable() }).nullable(),
  entityType: z.string(),
  /** Motif (actions de la console) ou requête faite chez un traiteur (méthode, chemin, statut). */
  detail: z.string().nullable(),
  ipAddress: z.string().nullable(),
});
export type PlatformAuditEntry = z.infer<typeof platformAuditEntrySchema>;

export const platformAuditPageSchema = z.object({
  items: z.array(platformAuditEntrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type PlatformAuditPage = z.infer<typeof platformAuditPageSchema>;

/** Valeurs proposées par les filtres : super admins, actions enregistrées, traiteurs. */
export const platformAuditOptionsSchema = z.object({
  actors: z.array(z.object({ id: z.uuid(), name: z.string() })),
  actions: z.array(z.string()),
  traiteurs: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type PlatformAuditOptions = z.infer<typeof platformAuditOptionsSchema>;

// ─────────────────────────── Matrice des permissions par défaut ───────────────────────────

/**
 * Matrice par défaut (tous les traiteurs) : modifiable dans la console. Chaque traiteur peut
 * ensuite l'ajuster, hors permissions critiques. Une case modifiée n'est plus touchée par la
 * synchronisation du catalogue au déploiement.
 */
export const PLATFORM_MATRIX_ROLES = [
  'ADMIN_TRAITEUR',
  'EMPLOYE',
  'EQUIPE',
  'LIVREUR',
  'CLIENT',
] as const satisfies readonly (typeof TENANT_ROLES)[number][];

const permissionCellSchema = z.object({
  granted: z.boolean(),
  /** Valeur du catalogue (packages/shared) : celle rétablie par « Valeur du catalogue ». */
  catalogDefault: z.boolean(),
});

export const platformPermissionMatrixSchema = z.object({
  roles: z.array(tenantRoleSchema),
  permissions: z.array(
    z.object({
      key: z.string(),
      module: z.string(),
      description: z.string(),
      /** false : permission critique, que les traiteurs ne peuvent pas ajuster. */
      isTenantEditable: z.boolean(),
      cells: z.record(tenantRoleSchema, permissionCellSchema),
    }),
  ),
});
export type PlatformPermissionMatrix = z.infer<typeof platformPermissionMatrixSchema>;

/** Une case : égale à la valeur du catalogue, elle redevient une case du catalogue. */
export const platformPermissionUpdateSchema = z.object({ granted: z.boolean() });
export type PlatformPermissionUpdateInput = z.infer<typeof platformPermissionUpdateSchema>;
