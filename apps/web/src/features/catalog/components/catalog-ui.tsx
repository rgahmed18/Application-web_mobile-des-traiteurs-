'use client';

import type { ImageVariant } from '@traiteur/shared';
import { ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { SelectTrigger, SelectValue } from '@/components/ui/select';

import { mediaUrl } from '../media/media-url';

/** Vignette de la photo d'un élément (ou pictogramme s'il n'en a pas). */
export function ItemThumb({
  imageKey,
  alt,
  size = 'md',
  variant = 'thumb',
}: {
  imageKey: string | null;
  alt: string;
  size?: 'md' | 'lg';
  variant?: ImageVariant;
}) {
  const dimension = size === 'lg' ? 'size-20' : 'size-14';
  if (!imageKey) {
    return (
      <span
        className={`flex ${dimension} shrink-0 items-center justify-center rounded-lg bg-muted`}
      >
        <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
      </span>
    );
  }
  return (
    // Images servies par le stockage public (CDN) : pas d'optimisation Next nécessaire
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mediaUrl(imageKey, variant)}
      alt={alt}
      loading="lazy"
      className={`${dimension} shrink-0 rounded-lg object-cover`}
    />
  );
}

type BadgeTone = 'success' | 'muted' | 'warning';

const TONES: Record<BadgeTone, string> = {
  success: 'border-transparent bg-emerald-100 text-emerald-800',
  muted: 'border-transparent bg-muted text-muted-foreground',
  warning: 'border-transparent bg-amber-100 text-amber-900',
};

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <Badge variant="outline" className={`text-sm ${TONES[tone]}`}>
      {children}
    </Badge>
  );
}

/**
 * Déclencheur d'un filtre de liste : le critère reste affiché devant la valeur (« Catégorie :
 * Chaises », « Gamme : toutes »), pour distinguer des filtres aux valeurs proches.
 */
export function FilterTrigger({ label }: { label: string }) {
  const t = useTranslations('catalog.filters');
  return (
    <SelectTrigger className="w-full" aria-label={label}>
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0 text-muted-foreground">{t('label', { label })}</span>
        <SelectValue />
      </span>
    </SelectTrigger>
  );
}
