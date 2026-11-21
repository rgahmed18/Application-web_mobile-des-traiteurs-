'use client';

import { CircleDotIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Libellé « Modifications non enregistrées » (barres d'enregistrement). */
export function UnsavedLabel({ className }: { className?: string }) {
  const t = useTranslations('common.unsaved');
  return (
    <p
      className={cn('flex min-w-0 items-start gap-2 text-sm', className)}
      data-testid="unsaved-label"
    >
      <CircleDotIcon className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      <span>
        <span className="font-bold">{t('label')}</span>
        <span className="hidden text-muted-foreground sm:inline"> — {t('hint')}</span>
      </span>
    </p>
  );
}

/**
 * Barre fixe en bas du formulaire, visible dès qu'il y a une modification :
 * « Modifications non enregistrées — [Annuler] [Enregistrer] ». Un brouillon enregistré
 * automatiquement n'est jamais appliqué : seul « Enregistrer » applique les réglages.
 */
export function UnsavedChangesBar({
  dirty,
  submitting,
  onReset,
  actions,
}: {
  dirty: boolean;
  submitting: boolean;
  onReset: () => void;
  /** Boutons propres au formulaire (à la place d'« Enregistrer »). */
  actions?: ReactNode;
}) {
  const tc = useTranslations('common');
  if (!dirty && !submitting) return null;
  return (
    <div
      role="region"
      aria-label={tc('unsaved.label')}
      className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-amber-300 bg-amber-50/95 px-4 py-3 shadow-[0_-8px_20px_-12px_rgb(0_0_0/0.3)] backdrop-blur sm:-mx-6 sm:px-6 dark:border-amber-800 dark:bg-amber-950/95"
      data-testid="unsaved-bar"
    >
      <UnsavedLabel />
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled={submitting} onClick={onReset}>
          {tc('cancel')}
        </Button>
        {actions ?? (
          <Button type="submit" disabled={submitting} data-testid="unsaved-save">
            {submitting ? tc('saving') : tc('save')}
          </Button>
        )}
      </div>
    </div>
  );
}
