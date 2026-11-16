'use client';

import { SITE_FEATURED_MAX, SITE_FEATURED_MIN, type SiteFeaturedItem } from '@traiteur/shared';
import { ArrowDownIcon, ArrowUpIcon, ImageIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBuffets, usePackages } from '@/features/catalog/catalog-api';
import { OffSiteBadge } from '@/features/catalog/components/catalog-ui';
import { mediaUrl } from '@/features/catalog/media/media-url';
import { useLocalized } from '@/features/catalog/use-localized';

interface Candidate extends SiteFeaturedItem {
  name: string;
  imageKey: string | null;
  isPublished: boolean;
  archivedAt: string | null;
}

/**
 * Menus et buffets mis en avant sur l'accueil : 3 à 6, dans l'ordre choisi. Aucun choix : les
 * premiers menus et buffets publiés avec photo. Un élément « Hors site » choisi ne s'affiche pas.
 */
export function SiteFeaturedField({
  value,
  onChange,
}: {
  value: SiteFeaturedItem[];
  onChange: (items: SiteFeaturedItem[]) => void;
}) {
  const t = useTranslations('settings.site.featured');
  const localized = useLocalized();
  const menus = usePackages({ pageSize: 100 });
  const buffets = useBuffets({ pageSize: 100 });
  if (menus.isPending || buffets.isPending) return <Skeleton className="h-40 w-full" />;

  const candidates: Candidate[] = [
    ...(menus.data?.items ?? []).map((row) => ({ kind: 'menu' as const, ...pick(row) })),
    ...(buffets.data?.items ?? []).map((row) => ({ kind: 'buffet' as const, ...pick(row) })),
  ];
  function pick(row: {
    id: string;
    name: Parameters<typeof localized>[0];
    imageKey: string | null;
    isPublished: boolean;
    archivedAt: string | null;
  }) {
    return {
      id: row.id,
      name: localized(row.name),
      imageKey: row.imageKey,
      isPublished: row.isPublished,
      archivedAt: row.archivedAt,
    };
  }
  const same = (a: SiteFeaturedItem) => (b: SiteFeaturedItem) => a.kind === b.kind && a.id === b.id;
  const selected = value.flatMap((item) => candidates.find(same(item)) ?? []);
  const available = candidates.filter((item) => !value.some(same(item)));
  const full = value.length >= SITE_FEATURED_MAX;
  const move = (index: number, offset: -1 | 1) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + offset, 0, item);
    onChange(next);
  };

  const row = (item: Candidate) => (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {item.imageKey ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl(item.imageKey, 'thumb')}
          alt=""
          className="size-10 rounded-md object-cover"
        />
      ) : (
        <span className="grid size-10 place-items-center rounded-md bg-muted">
          <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.name}</span>
        <span className="text-sm text-muted-foreground">{t(`kinds.${item.kind}`)}</span>
      </span>
      <OffSiteBadge item={item} />
    </span>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="site-featured">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {value.length === 0
          ? t('auto')
          : t('count', { count: value.length, min: SITE_FEATURED_MIN, max: SITE_FEATURED_MAX })}
      </p>
      {selected.length > 0 && (
        <ol className="flex flex-col divide-y rounded-xl border">
          {selected.map((item, index) => (
            <li
              key={`${item.kind}:${item.id}`}
              className="flex items-center gap-2 p-2"
              data-testid="featured-selected"
            >
              {row(item)}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={t('moveUp')}
              >
                <ArrowUpIcon aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={index === selected.length - 1}
                onClick={() => move(index, 1)}
                aria-label={t('moveDown')}
              >
                <ArrowDownIcon aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(value.filter((entry) => !same(item)(entry)))}
                aria-label={t('remove', { name: item.name })}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {available.length > 0 && (
        <div className="rounded-xl border">
          <p className="p-3 text-sm font-medium">{t('add')}</p>
          <ul className="flex max-h-80 flex-col divide-y overflow-y-auto border-t">
            {available.map((item) => (
              <li
                key={`${item.kind}:${item.id}`}
                className="flex items-center gap-2 p-2"
                data-testid="featured-candidate"
              >
                {row(item)}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={full}
                  onClick={() => onChange([...value, { kind: item.kind, id: item.id }])}
                  data-testid="featured-add"
                >
                  <PlusIcon aria-hidden />
                  {t('addOne')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
