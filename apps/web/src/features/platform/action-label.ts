'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/**
 * Actions du journal qui ont un libellé dans la console (les autres s'affichent telles quelles).
 * Clés sans point : le point est réservé à l'imbrication des messages (« traiteur.created » →
 * « traiteur_created »).
 */
const KNOWN_ACTIONS = [
  'traiteur_created',
  'super_admin_created',
  'super_admin_activated',
  'super_admin_2fa_reset',
  'platform_traiteur_created',
  'platform_admin_invitation_resent',
  'platform_plan_changed',
  'platform_feature_toggled',
  'platform_traiteur_suspended',
  'platform_traiteur_reactivated',
  'platform_trial_updated',
  'platform_subscription_activated',
  'platform_plan_price_changed',
  'platform_access_started',
  'platform_access_extended',
  'platform_access_ended',
  'platform_access_request',
  'platform_permission_default_changed',
  'platform_domain_added',
  'platform_domain_verified',
  'platform_domain_disabled',
  'platform_domain_removed',
] as const;
type KnownAction = (typeof KNOWN_ACTIONS)[number];

function isKnownAction(key: string): key is KnownAction {
  return (KNOWN_ACTIONS as readonly string[]).includes(key);
}

/** Libellé d'une action du journal d'audit, dans la langue de l'interface. */
export function useActionLabel(): (action: string) => string {
  const t = useTranslations('platform.actions');
  return useCallback(
    (action: string) => {
      const key = action.replaceAll('.', '_');
      return isKnownAction(key) ? t(key) : action;
    },
    [t],
  );
}
