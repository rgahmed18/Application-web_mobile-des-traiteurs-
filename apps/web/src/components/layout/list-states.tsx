'use client';

import { ChevronLeftIcon, ChevronRightIcon, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

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
