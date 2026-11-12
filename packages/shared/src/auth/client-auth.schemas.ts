import { z } from 'zod';

import { localeSchema } from '../i18n/localized-text';
import { otpCodeSchema, otpRequestResponseSchema, traiteurSlugSchema } from './auth.schemas';
import { phoneSchema } from './phone';

/**
 * Connexion et inscription des clients sur le site d'un traiteur, sans mot de passe : code par
 * SMS (numéros marocains) ou par e-mail (numéros étrangers, qui ne reçoivent pas de SMS).
 *
 * Une seule suite d'étapes : numéro (et e-mail si demandé), puis code. Un client de CE traiteur
 * est connecté ; sinon (compte inconnu, ou connu chez un autre traiteur, réponse identique),
 * l'API demande l'inscription : nom, e-mail facultatif et consentement à la politique de
 * confidentialité de ce traiteur (loi 09-08), envoyés avec le même code.
 */

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const nameSchema = z.string().trim().min(1).max(80);

/** Canal du code : SMS, ou e-mail pour un numéro qui ne reçoit pas de SMS. */
export const OTP_CHANNELS = ['SMS', 'EMAIL'] as const;
export const otpChannelSchema = z.enum(OTP_CHANNELS);
export type OtpChannel = z.infer<typeof otpChannelSchema>;

export const clientCodeRequestSchema = z.object({
  phone: phoneSchema,
  /** Obligatoire pour un numéro étranger (réponse EMAIL_REQUIRED sinon), ignoré sinon. */
  email: emailSchema.optional(),
  /** Langue de l'e-mail de code. */
  locale: localeSchema.optional(),
});
export type ClientCodeRequestInput = z.infer<typeof clientCodeRequestSchema>;

export const clientCodeResponseSchema = otpRequestResponseSchema.extend({
  channel: otpChannelSchema,
});
export type ClientCodeResponse = z.infer<typeof clientCodeResponseSchema>;

/** Inscription chez ce traiteur, envoyée avec le code quand l'API la demande. */
export const clientSignupSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  /** Facultatif pour un numéro marocain ; un numéro étranger utilise l'adresse du code. */
  email: emailSchema.optional(),
  locale: localeSchema.optional(),
  /** Case cochée : consentement à la politique de confidentialité de ce traiteur. */
  consent: z.literal(true),
  /** Version de la politique affichée (publicPrivacySchema.version). */
  privacyVersion: z.string().min(1).max(64),
});
export type ClientSignupInput = z.infer<typeof clientSignupSchema>;

/** Consentement seul : client déjà connu du traiteur (fiche créée au back-office). */
export const clientConsentSchema = clientSignupSchema.pick({ consent: true, privacyVersion: true });
export type ClientConsentInput = z.infer<typeof clientConsentSchema>;

export const clientVerifySchema = z.object({
  phone: phoneSchema,
  /** Adresse qui a reçu le code (numéro étranger). */
  email: emailSchema.optional(),
  code: otpCodeSchema,
  /** Réponse SIGNUP_REQUIRED : inscription ; CONSENT_REQUIRED : consentement seul. */
  signup: clientSignupSchema.optional(),
  consent: clientConsentSchema.optional(),
});
export type ClientVerifyInput = z.infer<typeof clientVerifySchema>;

/** Versions de l'API : le traiteur vient de l'adresse, ajouté par le serveur web. */
export const apiClientCodeRequestSchema = clientCodeRequestSchema.extend({
  traiteurSlug: traiteurSlugSchema,
});
export type ApiClientCodeRequestInput = z.infer<typeof apiClientCodeRequestSchema>;

export const apiClientVerifySchema = clientVerifySchema.extend({
  traiteurSlug: traiteurSlugSchema,
});
export type ApiClientVerifyInput = z.infer<typeof apiClientVerifySchema>;
