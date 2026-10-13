import { z } from 'zod';

import { phoneSchema } from '../auth/phone';
import { STAFF_ROLES, staffRoleSchema } from '../enums';

/**
 * Personnel du traiteur : membres (Membership de rôle administrateur, bureau, équipe ou
 * livreur), invitations par lien d'activation, suspension, et grille des permissions par rôle.
 */

const nameSchema = z.string().trim().min(1).max(80);
const staffLocaleSchema = z.enum(['fr', 'ar']);

export const STAFF_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED'] as const;
export const staffStatusSchema = z.enum(STAFF_STATUSES);

// ─────────────────────────── Saisies ───────────────────────────

export const staffListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  role: staffRoleSchema.optional(),
  status: staffStatusSchema.optional(),
});
export type StaffListQuery = z.infer<typeof staffListQuerySchema>;

/** Invitation : un lien d'activation est créé (SMS si possible, toujours affiché une fois). */
export const staffInviteSchema = z.object({
  phone: phoneSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  role: staffRoleSchema,
  locale: staffLocaleSchema,
});
export type StaffInviteInput = z.infer<typeof staffInviteSchema>;

export const staffUpdateSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  role: staffRoleSchema,
  locale: staffLocaleSchema,
});
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

export const staffSuspendSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type StaffSuspendInput = z.infer<typeof staffSuspendSchema>;

// ─────────────────────────── Réponses ───────────────────────────

export const staffMemberSchema = z.object({
  /** Identifiant du Membership. */
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  role: staffRoleSchema,
  status: staffStatusSchema,
  locale: staffLocaleSchema,
  /** Invitation en cours (statut « invité »). */
  invitation: z
    .object({ expiresAt: z.iso.datetime(), smsSent: z.boolean(), expired: z.boolean() })
    .nullable(),
  suspendedAt: z.iso.datetime().nullable(),
  suspensionReason: z.string().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  /** Le membre connecté (ni suspension ni changement de rôle sur soi-même). */
  isSelf: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

/** Lien d'activation, affiché une seule fois à l'administrateur (seule l'empreinte est gardée). */
export const invitationLinkSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
  smsSent: z.boolean(),
});
export type InvitationLink = z.infer<typeof invitationLinkSchema>;

export const staffInviteResultSchema = z.object({
  member: staffMemberSchema,
  link: invitationLinkSchema,
});
export type StaffInviteResult = z.infer<typeof staffInviteResultSchema>;

// ─────────────────────────── Activation (page publique) ───────────────────────────

export const publicInvitationSchema = z.object({
  traiteurName: z.string(),
  firstName: z.string(),
  role: staffRoleSchema,
  /** Téléphone masqué (« +212 6•• •• •• 67 »). */
  phone: z.string(),
  /** Compte existant avec mot de passe : il le confirme au lieu d'en choisir un. */
  hasPassword: z.boolean(),
  expiresAt: z.iso.datetime(),
  /** Langue du membre : la page d'activation s'affiche dans cette langue. */
  locale: staffLocaleSchema,
});
export type PublicInvitation = z.infer<typeof publicInvitationSchema>;

/** Nouveau mot de passe (compte sans mot de passe) ou mot de passe actuel (compte existant). */
export const invitationAcceptSchema = z.object({ password: z.string().min(1).max(128) });
export type InvitationAcceptInput = z.infer<typeof invitationAcceptSchema>;

export const invitationAcceptResultSchema = z.object({
  /** Identifiant de connexion à préremplir (téléphone) et traiteur. */
  phone: z.string(),
  traiteurSlug: z.string(),
});
export type InvitationAcceptResult = z.infer<typeof invitationAcceptResultSchema>;

// ─────────────────────────── Grille des permissions ───────────────────────────

const byRole = z.object(
  Object.fromEntries(STAFF_ROLES.map((role) => [role, z.boolean()])) as Record<
    (typeof STAFF_ROLES)[number],
    z.ZodBoolean
  >,
);

export const permissionsMatrixSchema = z.object({
  roles: z.array(staffRoleSchema),
  permissions: z.array(
    z.object({
      key: z.string(),
      module: z.string(),
      /** false : permission critique, non modifiable par le traiteur. */
      editable: z.boolean(),
      defaults: byRole,
      granted: byRole,
    }),
  ),
});
export type PermissionsMatrix = z.infer<typeof permissionsMatrixSchema>;

/** États souhaités : une valeur égale au défaut supprime la surcharge, sinon elle l'enregistre. */
export const permissionsUpdateSchema = z.object({
  changes: z
    .array(z.object({ role: staffRoleSchema, key: z.string().max(80), granted: z.boolean() }))
    .min(1)
    .max(500),
});
export type PermissionsUpdateInput = z.infer<typeof permissionsUpdateSchema>;

export const permissionsResetSchema = z.object({ role: staffRoleSchema.nullable() });
export type PermissionsResetInput = z.infer<typeof permissionsResetSchema>;
