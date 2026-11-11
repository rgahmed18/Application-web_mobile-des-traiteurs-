'use client';

import { cn } from 'cn';
import type { ReactNode } from 'react';

import { RestoredFieldsContext } from '@/components/forms/restored-fields';

import type { FormDraft } from './use-form-draft';

/**
 * Champs d'un formulaire à brouillon, sous le bandeau (FormDraftNotice) :
 *   - brouillon trouvé, en attente de « Reprendre » ou « Supprimer » : champs verrouillés, pour
 *     que les valeurs reprises soient affichées AVANT toute saisie (une frappe dans un champ
 *     déjà rempli ne s'ajoute jamais à la valeur reprise) ;
 *   - brouillon repris : les champs qui en viennent sont marqués « Repris » (FormField).
 */
export function DraftFields({
  draft,
  children,
}: {
  draft: Pick<FormDraft, 'pending' | 'restored'>;
  children: ReactNode;
}) {
  const locked = draft.pending !== null;
  return (
    <RestoredFieldsContext value={draft.restored}>
      <div
        className={cn('contents', locked && '*:opacity-50')}
        inert={locked}
        data-testid="draft-fields"
        data-locked={locked || undefined}
      >
        {children}
      </div>
    </RestoredFieldsContext>
  );
}
