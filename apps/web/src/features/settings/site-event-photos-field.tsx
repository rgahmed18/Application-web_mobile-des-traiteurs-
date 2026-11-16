'use client';

import type { SiteEventTypePhoto } from '@traiteur/shared';
import { useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';
import { useCatalogList } from '@/features/catalog/catalog-api';
import { ImageUploadField } from '@/features/catalog/forms/image-upload-field';
import { useLocalized } from '@/features/catalog/use-localized';

/**
 * Photo propre à chaque type d'événement (cartes « Pour vos événements » de l'accueil). Sans
 * photo : celle d'un menu publié proposé pour ce type.
 */
export function SiteEventPhotosField({
  value,
  onChange,
  onBusyChange,
}: {
  value: SiteEventTypePhoto[];
  onChange: (photos: SiteEventTypePhoto[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('settings.site.eventPhotos');
  const localized = useLocalized();
  const types = useCatalogList('event-types');
  if (types.isPending) return <Skeleton className="h-40 w-full" />;
  const shown = (types.data ?? []).filter((type) => type.isActive && !type.archived);

  const set = (code: string, imageKey: string | null) =>
    onChange([
      ...value.filter((photo) => photo.code !== code),
      ...(imageKey ? [{ code, imageKey }] : []),
    ]);

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="site-event-photos">
      {shown.map((type) => {
        const name = localized(type.name);
        const own = value.find((photo) => photo.code === type.code)?.imageKey ?? null;
        return (
          <li key={type.code} className="flex flex-col gap-1">
            <ImageUploadField
              value={own}
              onChange={(imageKey) => set(type.code, imageKey)}
              onBusyChange={onBusyChange}
              alt={name}
              label={name}
              uploadPath="/settings/site/uploads"
            />
            {!own && <p className="text-sm text-muted-foreground">{t('auto')}</p>}
          </li>
        );
      })}
    </ul>
  );
}
