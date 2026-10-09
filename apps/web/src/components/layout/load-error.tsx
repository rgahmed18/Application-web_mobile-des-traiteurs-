'use client';

import { SearchXIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';

import { MessageScreen } from './message-screen';

/** Fiche introuvable (404, y compris celle d'un autre traiteur) ou erreur de chargement. */
export function LoadError({ error, backHref }: { error: unknown; backHref: string }) {
  const t = useTranslations();
  const describeError = useErrorMessage();
  const notFound = isApiError(error) && error.status === 404;
  return (
    <MessageScreen
      icon={notFound ? SearchXIcon : TriangleAlertIcon}
      title={notFound ? t('pages.notFoundTitle') : t('errors.generic')}
      description={notFound ? t('pages.notFoundDescription') : describeError(error)}
      actionLabel={t('common.back')}
      actionHref={backHref}
    />
  );
}
