'use client';

import { ACCEPTED_IMAGE_TYPES, SITE_PHOTOS_MAX } from '@traiteur/shared';
import { ArrowLeftIcon, ArrowRightIcon, LoaderIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { UnsupportedImageError } from '@/features/catalog/media/image-preparation';
import { mediaUrl } from '@/features/catalog/media/media-url';
import { uploadCatalogImage, type UploadProgress } from '@/features/catalog/media/upload-image';
import { useErrorMessage } from '@/lib/api/use-error-message';

interface SitePhotosFieldProps {
  value: string[];
  onChange: (photoKeys: string[]) => void;
  /** Signale un envoi en cours : le formulaire attend la fin avant d'enregistrer. */
  onBusyChange: (busy: boolean) => void;
}

/**
 * Photos de l'accueil du site client : ajout (6 au plus), ordre (la première est la photo
 * principale) et retrait. Les flèches suivent le sens de lecture (inversées en arabe).
 */
export function SitePhotosField({ value, onChange, onBusyChange }: SitePhotosFieldProps) {
  const t = useTranslations('settings.site.photos');
  const tp = useTranslations('catalog.photo');
  const describeError = useErrorMessage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  async function handleFile(file: File) {
    onBusyChange(true);
    try {
      const imageKey = await uploadCatalogImage(file, setProgress, '/settings/site/uploads');
      onChange([...value, imageKey]);
    } catch (error) {
      toast.error(
        error instanceof UnsupportedImageError ? tp('unsupported') : describeError(error),
      );
    } finally {
      setProgress(null);
      onBusyChange(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const move = (index: number, offset: -1 | 1) => {
    const next = [...value];
    const [photo] = next.splice(index, 1);
    if (photo === undefined) return;
    next.splice(index + offset, 0, photo);
    onChange(next);
  };

  const status =
    progress?.stage === 'preparing'
      ? tp('preparing')
      : progress?.stage === 'uploading'
        ? tp('uploading', { percent: progress.percent })
        : progress?.stage === 'processing'
          ? tp('processing')
          : null;

  return (
    <div className="flex flex-col gap-3" data-testid="site-photos">
      {value.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {value.map((key, index) => (
            <li key={key} className="flex flex-col gap-2" data-testid="site-photo">
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaUrl(key, 'thumb')}
                  alt={t('alt', { position: index + 1 })}
                  className="size-full object-cover"
                />
                {index === 0 && (
                  <span className="absolute start-2 top-2 rounded-md bg-background/90 px-2 py-0.5 text-xs font-medium">
                    {t('main')}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={index === 0 || progress !== null}
                  onClick={() => move(index, -1)}
                  aria-label={t('moveBefore')}
                >
                  <ArrowLeftIcon className="rtl:rotate-180" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={index === value.length - 1 || progress !== null}
                  onClick={() => move(index, 1)}
                  aria-label={t('moveAfter')}
                >
                  <ArrowRightIcon className="rtl:rotate-180" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ms-auto"
                  disabled={progress !== null}
                  onClick={() => onChange(value.filter((item) => item !== key))}
                  aria-label={tp('remove')}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {status && (
        <p className="flex items-center gap-2 text-sm font-medium" role="status">
          <LoaderIcon className="size-4 animate-spin" aria-hidden />
          {status}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={[...ACCEPTED_IMAGE_TYPES, '.heic', '.heif'].join(',')}
        className="sr-only"
        data-testid="site-photo-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={progress !== null || value.length >= SITE_PHOTOS_MAX}
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon aria-hidden />
          {tp('choose')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {value.length === 0
          ? t('fallback')
          : t('count', { count: value.length, max: SITE_PHOTOS_MAX })}{' '}
        {tp('hint')}
      </p>
    </div>
  );
}
