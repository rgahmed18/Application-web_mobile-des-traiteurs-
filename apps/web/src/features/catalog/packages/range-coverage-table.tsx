'use client';

import { CheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Card } from '@/components/ui/card';
import { useLocalized } from '@/features/catalog/use-localized';
import { RangeMark } from '@/features/site/range-finish';
import { cn } from '@/lib/utils';

import { useCatalogList, usePackages } from '../catalog-api';
import { rangeCoverage } from './range-coverage';

/**
 * « Couverture des gammes » : pour chaque type d'événement, les gammes qui ont au moins un menu
 * publié sur le site. Une case « manquant » s'affiche « sur demande » dans le comparateur.
 */
export function RangeCoverageTable() {
  const t = useTranslations('catalog.packages.coverage');
  const localized = useLocalized();
  const eventTypes = useCatalogList('event-types');
  const ranges = useCatalogList('ranges');
  // Menus non archivés (100 au plus : bien au-delà d'un catalogue de traiteur)
  const packages = usePackages({ page: 1, pageSize: 100 });
  if (!eventTypes.data || !ranges.data || !packages.data) return null;
  const coverage = rangeCoverage(packages.data.items, eventTypes.data, ranges.data);
  if (coverage.ranges.length === 0 || coverage.rows.length === 0) return null;

  return (
    <Card className="gap-3 p-4" data-testid="range-coverage">
      <div>
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">
          {coverage.missing === 0 ? t('complete') : t('missingCount', { count: coverage.missing })}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pe-3 text-start font-medium text-muted-foreground">
                {t('event')}
              </th>
              {coverage.ranges.map((range) => (
                <th key={range.id} scope="col" className="px-2 py-2 text-start font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <RangeMark finish={range.finish ?? 'ivory'} size="sm" />
                    {localized(range.name)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coverage.rows.map((row) => (
              <tr key={row.eventType.id} className="border-b last:border-0">
                <th scope="row" className="py-2 pe-3 text-start font-medium">
                  {localized(row.eventType.name)}
                </th>
                {row.counts.map((count, index) => (
                  <td
                    key={coverage.ranges[index]?.id ?? index}
                    className={cn('px-2 py-2', count === 0 && 'text-amber-700')}
                    data-testid="coverage-cell"
                    data-covered={count > 0}
                  >
                    {count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckIcon className="size-4" aria-hidden />
                        <span>{t('covered', { count })}</span>
                      </span>
                    ) : (
                      t('missing')
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
