'use client';

import type { OrderStatus } from '@traiteur/shared';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Couleur de chaque statut, partagée par les listes, les fiches et le calendrier.
 * Teintes lisibles en clair comme en sombre ; le libellé accompagne toujours la couleur.
 */
export const STATUS_STYLES: Record<OrderStatus, { badge: string; dot: string; chip: string }> = {
  DRAFT: {
    badge:
      'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    dot: 'bg-zinc-400',
    chip: 'border-s-zinc-400 bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
  },
  PENDING: {
    badge:
      'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
    dot: 'bg-amber-500',
    chip: 'border-s-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  },
  QUOTED: {
    badge:
      'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300',
    dot: 'bg-violet-500',
    chip: 'border-s-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  },
  CONFIRMED: {
    badge:
      'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    chip: 'border-s-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  },
  IN_PREPARATION: {
    badge:
      'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300',
    dot: 'bg-sky-500',
    chip: 'border-s-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  },
  OUT_FOR_DELIVERY: {
    badge:
      'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300',
    dot: 'bg-blue-600',
    chip: 'border-s-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  },
  DELIVERED: {
    badge:
      'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300',
    dot: 'bg-teal-600',
    chip: 'border-s-teal-600 bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-200',
  },
  COMPLETED: {
    badge:
      'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-500',
    chip: 'border-s-slate-500 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  },
  CANCELLED: {
    badge:
      'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
    dot: 'bg-red-500',
    chip: 'border-s-red-500 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300',
  },
};

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const t = useTranslations('orderStatus');
  return (
    <Badge
      variant="outline"
      className={cn('text-sm font-medium', STATUS_STYLES[status].badge, className)}
    >
      {t(status)}
    </Badge>
  );
}
