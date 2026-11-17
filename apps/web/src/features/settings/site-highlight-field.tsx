'use client';

import { useTranslations } from 'next-intl';

import { useCatalogList } from '@/features/catalog/catalog-api';
import { useLocalized } from '@/features/catalog/use-localized';
import { RangeBadge } from '@/features/site/range-finish';
import { cn } from '@/lib/utils';

/**
 * Gamme mise en avant dans le comparateur du site (badge « Le plus choisi », première carte sur
 * téléphone) : une des gammes disponibles, ou aucune.
 */
export function SiteHighlightField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const t = useTranslations('settings.site.highlight');
  const localized = useLocalized();
  const ranges = useCatalogList('ranges');
  const available = (ranges.data ?? []).filter((range) => range.isActive && !range.archived);
  const choices: { code: string | null; label: React.ReactNode }[] = [
    { code: null, label: t('none') },
    ...available.map((range) => ({
      code: range.code,
      label: <RangeBadge finish={range.finish ?? 'ivory'} name={localized(range.name)} />,
    })),
  ];
  return (
    <div role="radiogroup" aria-label={t('label')} className="flex flex-wrap gap-2">
      {choices.map((choice) => (
        <button
          key={choice.code ?? 'none'}
          type="button"
          role="radio"
          aria-checked={value === choice.code}
          onClick={() => onChange(choice.code)}
          className={cn(
            'inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-semibold transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            value === choice.code && 'border-foreground ring-1 ring-foreground',
          )}
          data-testid={`highlight-${choice.code ?? 'none'}`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
