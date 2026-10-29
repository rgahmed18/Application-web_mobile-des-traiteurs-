'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DraftFormKey } from '@traiteur/shared';
import { FileClockIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useErrorMessage } from '@/lib/api/use-error-message';

import { parseDraftKey, draftHref } from './draft-links';
import { deleteDraft, listDrafts } from './drafts-api';
import { draftMoment } from './form-draft-notice';

const DRAFTS_KEY = ['drafts'] as const;

/**
 * Tableau de bord : brouillons non terminés de l'utilisateur chez ce traiteur, à reprendre ou
 * supprimer (après une déconnexion, une expiration ou une fermeture de page).
 */
export function DraftsCard() {
  const t = useTranslations('drafts');
  const describeError = useErrorMessage();
  const queryClient = useQueryClient();
  const drafts = useQuery({ queryKey: DRAFTS_KEY, queryFn: listDrafts });
  const remove = useMutation({
    mutationFn: (formKey: DraftFormKey) => deleteDraft(formKey),
    onSuccess: async () => {
      toast.success(t('deleted'));
      await queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const list = drafts.data?.drafts ?? [];
  if (list.length === 0) return null;
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
      data-testid="drafts-card"
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <FileClockIcon className="size-5" aria-hidden />
        {t('title')}
      </h2>
      <ul className="flex flex-col gap-2">
        {list.map((draft) => {
          const { form, target } = parseDraftKey(draft.formKey);
          const moment = draftMoment(new Date(draft.updatedAt));
          const name = [t(`forms.${form}`), draft.label ?? (target === 'new' ? t('newItem') : null)]
            .filter(Boolean)
            .join(' — ');
          return (
            <li key={draft.formKey} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">
                <bdi className="font-medium">{name}</bdi>
                <span className="block text-xs opacity-80">{t('pending', moment)}</span>
              </span>
              <Button asChild size="sm">
                <Link href={draftHref(draft.formKey)}>{t('openDraft')}</Link>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`${t('discard')} : ${name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(draft.formKey)}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
