'use client';

import { ACCEPTED_IMAGE_TYPES } from '@traiteur/shared';
import { ImageIcon, LoaderIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useErrorMessage } from '@/lib/api/use-error-message';

import { UnsupportedImageError } from '../media/image-preparation';
import { mediaUrl } from '../media/media-url';
import { uploadCatalogImage, type UploadProgress } from '../media/upload-image';

interface ImageUploadFieldProps {
  value: string | null;
  onChange: (imageKey: string | null) => void;
  /** Signale un envoi en cours : le formulaire attend la fin avant d'enregistrer. */
  onBusyChange: (busy: boolean) => void;
  alt: string;
}

/** Photo d'un plat ou d'une formule : choix, envoi avec progression, aperçu, retrait. */
export function ImageUploadField({ value, onChange, onBusyChange, alt }: ImageUploadFieldProps) {
  const t = useTranslations('catalog.photo');
  const tf = useTranslations('catalog.fields');
  const describeError = useErrorMessage();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  async function handleFile(file: File) {
    onBusyChange(true);
    try {
      const imageKey = await uploadCatalogImage(file, setProgress);
      onChange(imageKey);
    } catch (error) {
      toast.error(error instanceof UnsupportedImageError ? t('unsupported') : describeError(error));
    } finally {
      setProgress(null);
      onBusyChange(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const status =
    progress?.stage === 'preparing'
      ? t('preparing')
      : progress?.stage === 'uploading'
        ? t('uploading', { percent: progress.percent })
        : progress?.stage === 'processing'
          ? t('processing')
          : null;

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">{tf('photo')}</span>
      <div className="relative flex aspect-[4/3] w-full max-w-sm items-center justify-center overflow-hidden rounded-xl border bg-muted">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(value, 'large')} alt={alt} className="size-full object-cover" />
        ) : (
          <ImageIcon className="size-12 text-muted-foreground" aria-hidden />
        )}
        {status && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/85 p-4 text-center"
            role="status"
          >
            <LoaderIcon className="size-6 animate-spin" aria-hidden />
            <span className="text-sm font-medium">{status}</span>
            {progress?.stage === 'uploading' && (
              <span className="h-2 w-40 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full bg-primary transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </span>
            )}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={[...ACCEPTED_IMAGE_TYPES, '.heic', '.heif'].join(',')}
        className="sr-only"
        data-testid="image-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={progress !== null}
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon aria-hidden />
          {value ? t('replace') : t('choose')}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            disabled={progress !== null}
            onClick={() => onChange(null)}
          >
            <Trash2Icon aria-hidden />
            {t('remove')}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
    </div>
  );
}
