import { z } from 'zod';

/**
 * Brouillons des formulaires du back-office, enregistrés CÔTÉ SERVEUR (jamais dans le
 * navigateur : PC partagés), liés à l'utilisateur ET au traiteur, supprimés après
 * l'enregistrement réel ou au bout de DRAFT_TTL_DAYS jours.
 */
export const DRAFT_TTL_DAYS = 30;
/** Taille maximale d'un brouillon (JSON), sous la limite des requêtes de l'API (100 Ko). */
export const DRAFT_MAX_BYTES = 90_000;

/** Formulaires concernés ; « new » = création, sinon l'identifiant de l'élément modifié. */
export const DRAFT_FORMS = [
  'order',
  'quote',
  'client',
  'dish',
  'package',
  'service',
  'equipment',
  'buffet',
] as const;
export const DRAFT_SETTINGS_SECTIONS = [
  'company',
  'billing',
  'pricing',
  'availability',
  'site',
] as const;
export type DraftForm = (typeof DRAFT_FORMS)[number] | 'settings';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FORM_KEY = new RegExp(
  `^(?:(?:${DRAFT_FORMS.join('|')}):(?:new|${UUID})|settings:(?:${DRAFT_SETTINGS_SECTIONS.join('|')}))$`,
);

/** Clé d'un brouillon : « order:new », « dish:<id> », « settings:company »… */
export const draftFormKeySchema = z.string().regex(FORM_KEY, 'Formulaire inconnu');
export type DraftFormKey = z.infer<typeof draftFormKeySchema>;

export function draftFormKey(form: DraftForm, target: string): DraftFormKey {
  return `${form}:${target}`;
}

/**
 * Champs JAMAIS enregistrés dans un brouillon (liste centralisée, appliquée par le navigateur
 * ET par l'API) : mots de passe, codes de double authentification, codes de secours, codes SMS.
 */
export const DRAFT_FORBIDDEN_FIELDS: readonly RegExp[] = [
  /pass(word|wd)?/i,
  /^(code|otp|totp|pin)$/i,
  /recovery/i,
  /two[-_]?factor|2fa/i,
  /challenge/i,
  /secret|token/i,
];

function isForbidden(key: string): boolean {
  return DRAFT_FORBIDDEN_FIELDS.some((pattern) => pattern.test(key));
}

/** Copie des valeurs d'un formulaire sans aucun champ sensible, à toute profondeur. */
export function stripSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitiveFields);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isForbidden(key))
      .map(([key, nested]) => [key, stripSensitiveFields(nested)]),
  );
}

export const draftSaveSchema = z.object({
  /** Résumé lisible pour la reprise (« Commande — Mariage Bennani »). */
  label: z.string().trim().max(160).nullable(),
  /** Version de l'élément au début de la saisie (version ou date de modification). */
  baseVersion: z.string().max(64).nullable(),
  data: z.record(z.string(), z.unknown()),
});
export type DraftSaveInput = z.infer<typeof draftSaveSchema>;

export const draftSummarySchema = z.object({
  formKey: draftFormKeySchema,
  label: z.string().nullable(),
  baseVersion: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type DraftSummary = z.infer<typeof draftSummarySchema>;

export const draftSchema = draftSummarySchema.extend({
  data: z.record(z.string(), z.unknown()),
});
export type Draft = z.infer<typeof draftSchema>;

export const draftListSchema = z.object({ drafts: z.array(draftSummarySchema) });
export type DraftList = z.infer<typeof draftListSchema>;
