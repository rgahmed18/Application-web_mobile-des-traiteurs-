import { z } from 'zod';

import { passwordSchema } from '../auth/auth.schemas';
import { phoneSchema } from '../auth/phone';
import { PRICE_MODES } from '../money/money';

/**
 * Paramètres du traiteur (permission settings.manage) et compte de l'utilisateur connecté.
 * Documents et paiements : voir billingSettingsSchema.
 */

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));

// ─────────────────────────── Entreprise ───────────────────────────

/** Coordonnées affichées aux clients et sur les documents (nom commercial, contact, ville). */
export const companySettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  phone: phoneSchema,
  city: nullableText(80),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

// ─────────────────────────── Disponibilités ───────────────────────────

/** Jours de la semaine ISO : 1 = lundi … 7 = dimanche. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const availabilitySettingsSchema = z.object({
  /** Événements fermes maximum par jour ; null = pas de limite. */
  maxEventsPerDay: z.number().int().min(1).max(100).nullable(),
  /** Fermeture hebdomadaire : au moins un jour reste ouvert. */
  closedWeekdays: z
    .array(z.number().int().min(1).max(7))
    .max(6)
    .refine((days) => new Set(days).size === days.length, 'Jour en double')
    .transform((days) => [...days].sort((a, b) => a - b)),
  /** Missions terminées : adresse et contact masqués après N jours (null = jamais). */
  missionRedactionDays: z.number().int().min(1).max(365).nullable(),
  /** Matériel : occupé de (début − installation) à (fin + retour), en heures. */
  equipmentSetupHours: z.number().int().min(0).max(240),
  equipmentReturnHours: z.number().int().min(0).max(240),
});
export type AvailabilitySettings = z.infer<typeof availabilitySettingsSchema>;

// ─────────────────────────── Mode de prix ───────────────────────────

export const pricingSettingsInputSchema = z.object({
  /** Prix saisis HT ou TTC pour les nouveaux prix et les nouveaux documents. */
  priceEntryMode: z.enum(PRICE_MODES),
});
export type PricingSettingsInput = z.infer<typeof pricingSettingsInputSchema>;

export const pricingSettingsSchema = pricingSettingsInputSchema.extend({
  isVatRegistered: z.boolean(),
  defaultTaxRateBps: z.number().int(),
});
export type PricingSettings = z.infer<typeof pricingSettingsSchema>;

// ─────────────────────────── Mon compte ───────────────────────────

export const ACCOUNT_LOCALES = ['fr', 'ar'] as const;

export const accountSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  locale: z.enum(ACCOUNT_LOCALES),
  /** Compte sans mot de passe (connexion par code SMS) : il peut en définir un. */
  hasPassword: z.boolean(),
});
export type Account = z.infer<typeof accountSchema>;

export const accountUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  locale: z.enum(ACCOUNT_LOCALES),
});
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

/** Changement de mot de passe : toutes les sessions sont fermées, reconnexion nécessaire. */
export const passwordChangeSchema = z.object({
  /** Mot de passe actuel (absent si le compte n'en a pas encore). */
  currentPassword: z.string().max(128).nullable(),
  newPassword: passwordSchema,
});
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
