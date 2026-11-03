'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';

import type { FormDraft } from './use-form-draft';

/**
 * Enregistrement refusé : l'élément a été modifié entre-temps (409 EDIT_CONFLICT). Message
 * avec « Voir la version actuelle » : la saisie est enregistrée en brouillon, le formulaire
 * remis sur la version chargée et les données relues (formulaire reconstruit si la version a
 * changé : clé = élément + version) ; le brouillon reste proposé (« Reprendre / Supprimer »,
 * conflit signalé).
 *
 * Retourne une fonction qui affiche ce message et renvoie true pour un conflit, false sinon.
 */
export function useEditConflict(draft: Pick<FormDraft, 'showCurrent'> | null) {
  const t = useTranslations('drafts');
  const describeError = useErrorMessage();
  const queryClient = useQueryClient();
  return useCallback(
    (error: unknown): boolean => {
      if (!isApiError(error) || error.code !== 'EDIT_CONFLICT') return false;
      const id = toast.error(describeError(error), {
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: t('showCurrent'),
          onClick: () => {
            toast.dismiss(id);
            void (async () => {
              await draft?.showCurrent();
              await queryClient.invalidateQueries();
            })();
          },
        },
      });
      return true;
    },
    [describeError, draft, queryClient, t],
  );
}
