import type { SubscriptionPlan } from '../enums';

/** Fonctionnalités activables par traiteur (FeatureFlag.key). */
export const FEATURE_KEYS = [
  'quotes',
  'invoices',
  'online_payment',
  'staff_app',
  'delivery_tracking',
  'multi_language',
  'analytics',
  'chatbot',
  'whatsapp',
  'custom_domain',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * Fonctionnalités incluses par défaut dans chaque offre. Sert à initialiser les
 * FeatureFlag d'un nouveau traiteur ; chaque flag reste ensuite modifiable en base.
 */
export const PLAN_FEATURES: Readonly<Record<SubscriptionPlan, readonly FeatureKey[]>> = {
  BASIQUE: ['quotes', 'invoices'],
  PRO: ['quotes', 'invoices', 'staff_app', 'delivery_tracking', 'multi_language', 'analytics'],
  PREMIUM: FEATURE_KEYS,
};

/** Valeurs initiales de tous les flags pour une offre donnée. */
export function getDefaultFeatureFlags(
  plan: SubscriptionPlan,
): { key: FeatureKey; enabled: boolean }[] {
  const included = new Set<FeatureKey>(PLAN_FEATURES[plan]);
  return FEATURE_KEYS.map((key) => ({ key, enabled: included.has(key) }));
}
