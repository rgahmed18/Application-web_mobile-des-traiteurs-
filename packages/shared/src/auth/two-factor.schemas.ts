import { z } from 'zod';

import { authSessionSchema } from './auth.schemas';

/**
 * Double authentification (TOTP, type Google Authenticator) : obligatoire pour le SUPER_ADMIN,
 * facultative pour les autres comptes. Codes de secours à usage unique, affichés une seule fois.
 */

/** Nombre de codes de secours générés à chaque fois. */
export const RECOVERY_CODE_COUNT = 10;

/** Code de l'application (6 chiffres) ou code de secours (« ABCD-EFGH »), espaces tolérés. */
export const twoFactorCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^(\d{6}|[A-Z0-9]{4}-?[A-Z0-9]{4})$/, 'Code invalide')
      .max(9),
  );

/** Code à 6 chiffres de l'application uniquement (activation, régénération des codes). */
export const totpCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Code à 6 chiffres'));

/**
 * Connexion en attente de la deuxième étape. VERIFY : saisir le code ; SETUP : la double
 * authentification est imposée (SUPER_ADMIN) mais pas encore configurée.
 */
export const twoFactorChallengeSchema = z.object({
  twoFactor: z.enum(['VERIFY', 'SETUP']),
  challengeToken: z.string(),
  /** Durée de validité du jeton, en secondes. */
  expiresIn: z.number().int().positive(),
});
export type TwoFactorChallenge = z.infer<typeof twoFactorChallengeSchema>;

/** Réponse d'une connexion (mot de passe ou code SMS) : session, ou deuxième étape. */
export const loginResultSchema = z.union([authSessionSchema, twoFactorChallengeSchema]);
export type LoginResult = z.infer<typeof loginResultSchema>;

export function isTwoFactorChallenge(value: LoginResult): value is TwoFactorChallenge {
  return 'twoFactor' in value;
}

const challengeTokenSchema = z.string().min(20).max(100);

export const twoFactorVerifySchema = z.object({
  challengeToken: challengeTokenSchema,
  code: twoFactorCodeSchema,
});
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;

export const twoFactorChallengeSetupSchema = z.object({ challengeToken: challengeTokenSchema });
export type TwoFactorChallengeSetupInput = z.infer<typeof twoFactorChallengeSetupSchema>;

export const twoFactorChallengeConfirmSchema = z.object({
  challengeToken: challengeTokenSchema,
  code: totpCodeSchema,
});
export type TwoFactorChallengeConfirmInput = z.infer<typeof twoFactorChallengeConfirmSchema>;

/** Informations d'activation : à scanner (QR) ou à saisir à la main (clé). */
export const twoFactorSetupInfoSchema = z.object({
  /** Clé en base32, groupée par 4 caractères pour la saisie manuelle. */
  secret: z.string(),
  otpauthUri: z.string(),
  /** QR code au format SVG. */
  qrSvg: z.string(),
});
export type TwoFactorSetupInfo = z.infer<typeof twoFactorSetupInfoSchema>;

export const recoveryCodesSchema = z.object({
  /** Affichés une seule fois : seule leur empreinte est conservée. */
  recoveryCodes: z.array(z.string()),
});
export type RecoveryCodes = z.infer<typeof recoveryCodesSchema>;

/** Activation imposée réussie à la connexion : session et codes de secours. */
export const twoFactorChallengeConfirmResultSchema = recoveryCodesSchema.extend({
  session: authSessionSchema,
});
export type TwoFactorChallengeConfirmResult = z.infer<typeof twoFactorChallengeConfirmResultSchema>;

// ─── Mon compte ───

export const twoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  enabledAt: z.iso.datetime().nullable(),
  /** Imposée pour ce compte (SUPER_ADMIN) : impossible à désactiver. */
  required: z.boolean(),
  recoveryCodesRemaining: z.number().int(),
});
export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;

export const twoFactorConfirmSchema = z.object({ code: totpCodeSchema });
export type TwoFactorConfirmInput = z.infer<typeof twoFactorConfirmSchema>;

/** Désactivation ou nouveaux codes de secours : un code valide est exigé. */
export const twoFactorProofSchema = z.object({ code: twoFactorCodeSchema });
export type TwoFactorProofInput = z.infer<typeof twoFactorProofSchema>;
