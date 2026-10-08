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

const nameSchema = z.string().trim().min(1).max(80);

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
 * Inscription d'un client auprès d'un traiteur, avec mot de passe.
 * Le téléphone doit être prouvé par un code SMS (OTP de type SIGNUP) : sans cela,
 * n'importe qui pourrait créer un compte au nom du numéro d'un tiers.
 */
export const registerSchema = z.object({
  traiteurSlug: traiteurSlugSchema,
  phone: phoneSchema,
  code: otpCodeSchema,
  email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  locale: localeSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Connexion par mot de passe. `identifier` = téléphone ou email.
 * Sans `traiteurSlug`, seule la connexion SUPER_ADMIN (contexte plateforme) est possible.
 */
export const loginSchema = z.object({
  traiteurSlug: traiteurSlugSchema.optional(),
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  purpose: otpPurposeSchema,
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

/**
 * Connexion ou inscription par code SMS. Si le compte n'existe pas encore,
 * `firstName` et `lastName` sont requis (inscription sans mot de passe).
 */
export const otpVerifySchema = z.object({
  traiteurSlug: traiteurSlugSchema,
  phone: phoneSchema,
  code: otpCodeSchema,
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  locale: localeSchema.optional(),
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
});
export type Me = z.infer<typeof meSchema>;

export const otpRequestResponseSchema = z.object({
  /** Délai avant de pouvoir redemander un code, en secondes. */
  retryAfterSeconds: z.number().int().nonnegative(),
  expiresInSeconds: z.number().int().positive(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;
