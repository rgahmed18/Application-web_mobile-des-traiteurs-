'use client';

import { ArrowRightIcon, MapPinIcon, PhoneIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalized } from '@/features/catalog/use-localized';

import { usePublicCatalogOptions, usePublicSite } from './site-api';

/**
 * Accueil du site client : photos, présentation, types d'événement (lien vers le catalogue
 * filtré) et contact public du traiteur.
 */
export function SiteHome() {
  const t = useTranslations('site.home');
  const localized = useLocalized();
  const site = usePublicSite();
  const options = usePublicCatalogOptions();
  if (site.isPending) return <Skeleton className="h-96 w-full" />;
  const data = site.data;
  const [main, ...others] = data?.photos ?? [];

  return (
    <div className="flex flex-col gap-8" data-testid="site-home">
      {main && (
        <div className="grid gap-2 md:grid-cols-3 md:grid-rows-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={main.url}
            alt={t('photoAlt', { position: 1 })}
            className="aspect-[4/3] w-full rounded-xl object-cover md:col-span-2 md:row-span-2 md:h-full"
          />
          {others.slice(0, 2).map((photo, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.url}
              src={photo.thumbUrl}
              alt={t('photoAlt', { position: index + 2 })}
              className="hidden aspect-[4/3] w-full rounded-xl object-cover md:block"
            />
          ))}
        </div>
      )}
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold" dir="auto">
          {data?.name}
        </h1>
        {data?.intro && (
          <p className="max-w-3xl text-lg leading-relaxed whitespace-pre-line" dir="auto">
            {localized(data.intro)}
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild size="lg">
            <Link href="/catalogue">
              {t('seeCatalog')}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/demande">{t('requestQuote')}</Link>
          </Button>
        </div>
      </section>
      {options.data && options.data.eventTypes.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{t('eventTypes')}</h2>
          <ul className="flex flex-wrap gap-2">
            {options.data.eventTypes.map((type) => (
              <li key={type.code}>
                <Button asChild variant="secondary">
                  <Link href={`/catalogue?type=${type.code}`}>{localized(type.name)}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && (
        <section className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-4">
          <h2 className="text-lg font-semibold">{t('contact')}</h2>
          {data.city && (
            <p className="flex items-center gap-2">
              <MapPinIcon className="size-4 text-muted-foreground" aria-hidden />
              {data.city}
            </p>
          )}
          <p className="flex items-center gap-2">
            <PhoneIcon className="size-4 text-muted-foreground" aria-hidden />
            <a href={`tel:${data.phone}`} dir="ltr" className="underline underline-offset-4">
              {data.phone}
            </a>
          </p>
        </section>
      )}
    </div>
  );
}
