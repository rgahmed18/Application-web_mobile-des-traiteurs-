import { z } from 'zod';

import { contentVersion } from '../editing/edit-version';
import { localeSchema, localizedTextSchema } from '../i18n/localized-text';

/**
 * Site client d'un traiteur (son adresse, à la racine) : informations publiques de l'accueil et
 * politique de confidentialité. Le nom et le logo viennent de l'espace résolu par l'adresse.
 */

/** Photo de l'accueil : grande taille (1200 px) et vignette (400 px). */
export const publicPhotoSchema = z.object({
  url: z.url(),
  thumbUrl: z.url(),
});
export type PublicPhoto = z.infer<typeof publicPhotoSchema>;

export const publicSiteSchema = z.object({
  slug: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  /** Contact public du traiteur (paramètres → Entreprise). */
  phone: z.string(),
  email: z.string(),
  defaultLocale: localeSchema,
  intro: localizedTextSchema.nullable(),
  /** Photos de l'accueil ; sans photo choisie, celles du catalogue (6 au plus). */
  photos: z.array(publicPhotoSchema),
  /** Nouveaux clients en attente de l'accord du traiteur avant leur première demande. */
  requireClientApproval: z.boolean(),
});
export type PublicSite = z.infer<typeof publicSiteSchema>;

// ─────────────────────── Politique de confidentialité ───────────────────────

/**
 * Version du modèle de politique (texte des messages du site client). À changer à chaque
 * modification du texte : les consentements enregistrés gardent la version acceptée.
 */
export const PRIVACY_TEMPLATE_VERSION = '2026-11';

/** Responsable du traitement : le traiteur, avec ses informations légales. */
export const privacyControllerSchema = z.object({
  name: z.string(),
  legalName: z.string().nullable(),
  legalForm: z.string().nullable(),
  ice: z.string().nullable(),
  rcNumber: z.string().nullable(),
  rcCourt: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  email: z.string(),
  phone: z.string(),
});
export type PrivacyController = z.infer<typeof privacyControllerSchema>;

export const publicPrivacySchema = z.object({
  /** Version acceptée par le client à son inscription (modèle + informations du traiteur). */
  version: z.string(),
  controller: privacyControllerSchema,
  cndpDeclaration: z.string().nullable(),
  /** Paragraphe libre du traiteur, ajouté à la fin. */
  extra: localizedTextSchema.nullable(),
});
export type PublicPrivacy = z.infer<typeof publicPrivacySchema>;

/** Version d'une politique : modèle et contenu propre au traiteur. */
export function privacyPolicyVersion(policy: Omit<PublicPrivacy, 'version'>): string {
  return `${PRIVACY_TEMPLATE_VERSION}.${contentVersion(policy).slice(2)}`;
}
