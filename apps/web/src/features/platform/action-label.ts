'use client';

import { auditActionKey, isAuditAction } from '@traiteur/shared';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import type messages from '../../../messages/fr.json';

type ActionKey = keyof (typeof messages)['platform']['actions'];

/**
 * Libellé lisible d'une action du journal d'audit, dans la langue de l'interface. Toutes les
 * actions du registre partagé (AUDIT_ACTIONS) ont un libellé FR et AR (test des traductions) ;
 * une valeur inconnue (ancienne entrée) affiche « Autre action », jamais le code technique.
 */
export function useActionLabel(): (action: string) => string {
  const t = useTranslations('platform.actions');
  return useCallback(
    (action: string) =>
      isAuditAction(action) ? t(auditActionKey(action) as ActionKey) : t('unknown'),
    [t],
  );
}
