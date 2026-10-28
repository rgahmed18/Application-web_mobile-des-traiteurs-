'use client';

import { LayersIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { initialsOf } from '@/features/navigation/traiteur-brand';

import { useSpace } from './space-provider';

/**
 * En-tête des pages sans session : marque du traiteur de l'adresse (nom, logo), ou « Console
 * plateforme » sur l'adresse de la console.
 */
export function SpaceBrand() {
  const t = useTranslations('platform');
  const space = useSpace();
  if (space?.kind !== 'traiteur') {
    return (
      <div className="flex items-center gap-3" data-testid="space-brand">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LayersIcon className="size-5" aria-hidden />
        </span>
        <span className="text-lg font-semibold">{t('brand')}</span>
      </div>
    );
  }
  const { name, logoUrl } = space.traiteur;
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="space-brand">
      {logoUrl ? (
        // Logo servi par le stockage (lien signé) : pas d'optimisation Next nécessaire
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="size-10 shrink-0 rounded-lg bg-white object-contain p-0.5"
        />
      ) : (
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
          aria-hidden
        >
          {initialsOf(name)}
        </span>
      )}
      <span className="truncate text-lg font-semibold" dir="auto">
        {name}
      </span>
    </div>
  );
}
