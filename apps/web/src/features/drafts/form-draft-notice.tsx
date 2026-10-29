'use client';

import { CloudOffIcon, CloudUploadIcon, FileClockIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import type { FormDraft } from './use-form-draft';

/** « 29/10 » et « 14:32 », dans l'heure de l'appareil. */
export function draftMoment(date: Date): { date: string; time: string } {
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/**
 * Au-dessus d'un formulaire : brouillon non terminé à reprendre ou supprimer (avec le conflit
 * éventuel), puis l'état de l'enregistrement automatique (« Brouillon enregistré à 14:32 »,
 * ou « Brouillon non enregistré » tant qu'un nouvel essai est en attente).
 */
export function FormDraftNotice({ draft }: { draft: FormDraft }) {
  const t = useTranslations('drafts');
  const [busy, setBusy] = useState(false);

  if (draft.pending) {
    const moment = draftMoment(new Date(draft.pending.updatedAt));
    return (
      <div
        role="status"
        data-testid="draft-banner"
        className="flex flex-col gap-3 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
      >
        <p className="flex items-start gap-2 font-medium">
          <FileClockIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          {t('pending', moment)}
        </p>
        {draft.conflict && (
          <p
            className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200"
            data-testid="draft-conflict"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('conflict')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={draft.resume}>
            {t('resume')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void draft.discard().finally(() => setBusy(false));
            }}
          >
            {t('discard')}
          </Button>
        </div>
      </div>
    );
  }

  if (draft.status === 'idle') return null;
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="draft-status"
      className={`flex items-center gap-1.5 text-sm ${
        draft.status === 'failed' ? 'font-medium text-destructive' : 'text-muted-foreground'
      }`}
    >
      {draft.status === 'failed' ? (
        <CloudOffIcon className="size-4" aria-hidden />
      ) : (
        <CloudUploadIcon className="size-4" aria-hidden />
      )}
      {draft.status === 'failed'
        ? t('failed')
        : draft.status === 'saving' || !draft.savedAt
          ? t('saving')
          : t('saved', { time: draftMoment(draft.savedAt).time })}
    </p>
  );
}
