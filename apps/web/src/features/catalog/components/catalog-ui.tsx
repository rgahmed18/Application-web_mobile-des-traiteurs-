'use client';

import type { ImageVariant } from '@traiteur/shared';
import { ChevronLeftIcon, ChevronRightIcon, ImageIcon, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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

/** Liste vide : explication et action principale, pour guider un premier usage. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <Icon className="size-10 text-muted-foreground" aria-hidden />
      <p className="text-lg font-medium">{title}</p>
      <p className="max-w-md text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

/** Pagination simple : précédent / suivant, gros boutons. */
export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const t = useTranslations('common');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav
      className="flex items-center justify-between gap-2"
      aria-label={t('pagination', { current: page, total: pages })}
    >
      <Button variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeftIcon className="rtl:rotate-180" aria-hidden />
        {t('previousPage')}
      </Button>
      <span className="text-sm text-muted-foreground">
        {t('pagination', { current: page, total: pages })}
      </span>
      <Button variant="outline" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
        {t('nextPage')}
        <ChevronRightIcon className="rtl:rotate-180" aria-hidden />
      </Button>
    </nav>
  );
}
