'use client';

import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Section de formulaire : titre et champs dans une carte. */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">{children}</CardContent>
    </Card>
  );
}

/** En-tête de formulaire : retour à la liste et titre. */
export function FormHeader({ title, backHref }: { title: string; backHref: string }) {
  const t = useTranslations('common');
  return (
    <div className="flex flex-col gap-2">
      <Button asChild variant="link" className="self-start px-0">
        <Link href={backHref}>
          <ArrowLeftIcon className="rtl:rotate-180" aria-hidden />
          {t('back')}
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
    </div>
  );
}

/** Barre d'actions fixée en bas de l'écran : enregistrer reste accessible sur tablette. */
export function FormActions({
  cancelHref,
  submitting,
  disabled,
}: {
  cancelHref: string;
  submitting: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('common');
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <Button asChild variant="outline" size="lg">
        <Link href={cancelHref}>{t('cancel')}</Link>
      </Button>
      <Button type="submit" size="lg" disabled={submitting || disabled}>
        {submitting ? t('saving') : t('save')}
      </Button>
    </div>
  );
}
