import { z } from 'zod';

import { roleSchema } from '../enums';
import { localeSchema } from '../i18n/localized-text';
import { phoneSchema } from './phone';

export const OTP_CODE_LENGTH = 6;

export const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(128, 'Le mot de passe est trop long')
  .regex(/\p{L}/u, 'Le mot de passe doit contenir au moins une lettre')
  .regex(/\d/, 'Le mot de passe doit contenir au moins un chiffre');

export const traiteurSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Identifiant de traiteur invalide');

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(
    new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`),
    `Le code doit contenir ${OTP_CODE_LENGTH} chiffres`,
  );

export const OTP_PURPOSES = ['LOGIN', 'SIGNUP', 'PASSWORD_RESET'] as const;
export const otpPurposeSchema = z.enum(OTP_PURPOSES);
export type OtpPurpose = z.infer<typeof otpPurposeSchema>;

// ─── Requêtes ───

/**
 * Espace d'où vient la connexion :
 *   - « client » (par défaut, applications des clients) : un Membership actif chez ce traiteur
 *     est exigé ; sinon SIGNUP_REQUIRED (inscription avec consentement : client-auth.schemas) ;
 *   - « backoffice » (espace de gestion, posé par le serveur web) : un Membership du personnel
 *     actif chez CE traiteur est exigé.
 */
export const AUTH_SPACES = ['client', 'backoffice'] as const;
export const authSpaceSchema = z.enum(AUTH_SPACES);
export type AuthSpace = z.infer<typeof authSpaceSchema>;

/**
 * Connexion par mot de passe. `identifier` = téléphone ou email.
 * Sans `traiteurSlug`, seule la connexion SUPER_ADMIN (contexte plateforme) est possible.
 */
export const loginSchema = z.object({
  traiteurSlug: traiteurSlugSchema.optional(),
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
  space: authSpaceSchema.optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  purpose: otpPurposeSchema,
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

/**
 * Connexion par code SMS d'un compte existant, déjà membre de ce traiteur. Jamais de création de
 * compte ici : l'inscription des clients passe par client-auth.schemas (consentement).
 */
export const otpVerifySchema = z.object({
  traiteurSlug: traiteurSlugSchema,
  phone: phoneSchema,
  code: otpCodeSchema,
  space: authSpaceSchema.optional(),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const passwordResetSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
  newPassword: passwordSchema,
});
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// ─── Réponses ───

export const authUserSchema = z.object({
  id: z.uuid(),
  phone: z.string(),
  email: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  locale: localeSchema,
  isSuperAdmin: z.boolean(),
  hasPassword: z.boolean(),
  /** Double authentification activée sur ce compte. */
  twoFactorEnabled: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authContextSchema = z.object({
  traiteurId: z.uuid().nullable(),
  membershipId: z.uuid().nullable(),
  role: roleSchema,
});
export type AuthContext = z.infer<typeof authContextSchema>;

export const authSessionSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  /** Durée de validité de l'access token, en secondes. */
  expiresIn: z.number().int().positive(),
  refreshToken: z.string(),
  user: authUserSchema,
  context: authContextSchema,
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const meSchema = z.object({
  user: authUserSchema,
  context: authContextSchema,
  permissions: z.array(z.string()),
  /** Super admin entré chez un traiteur : accès en cours (bandeau, temps restant). */
  platformAccess: z
    .object({
      id: z.uuid(),
      traiteurName: z.string(),
      reason: z.string(),
      startedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
  /** Traiteur du contexte (marque blanche du back-office) ; null dans la console. */
  traiteur: z
    .object({
      name: z.string(),
      /** Logo (lien signé d'une heure), null s'il n'y en a pas. */
      logoUrl: z.string().nullable(),
    })
    .nullable(),
});
export type Me = z.infer<typeof meSchema>;

export const otpRequestResponseSchema = z.object({
  /** Délai avant de pouvoir redemander un code, en secondes. */
  retryAfterSeconds: z.number().int().nonnegative(),
  expiresInSeconds: z.number().int().positive(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;
