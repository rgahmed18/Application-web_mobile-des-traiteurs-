'use client';

import type { PublicFeatured, PublicPhoto } from '@traiteur/shared';
import { ArrowRightIcon, MailIcon, MapPinIcon, PhoneIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalized } from '@/features/catalog/use-localized';
import { useSpace } from '@/features/space/space-provider';
import { formatMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';

import { AddToCartButton } from './catalog-card';
import { HomeRangeChooser } from './range-comparator';
import { usePublicCatalogOptions, usePublicSite } from './site-api';
import { useListShown } from './site-lists';
import { useReveal } from './use-reveal';
import { WhatsAppIcon, whatsappUrl } from './whatsapp-button';

/** Colonnes de la galerie sur grand écran, selon le nombre de photos (grille toujours pleine). */
const GALLERY_COLUMNS: Record<number, string> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-[1.4fr_1fr_1fr]',
};

/** Petit titre d'accent, grand titre (police des titres) et filet de points. */
function SectionHead({ kicker, title, light }: { kicker: string; title: string; light?: boolean }) {
  const reveal = useReveal<HTMLDivElement>();
  return (
    <div ref={reveal} className="site-reveal mb-8 flex flex-col items-center gap-2 text-center">
      <span
        className={cn(
          'text-xs font-extrabold tracking-[0.2em] uppercase rtl:text-[0.95rem] rtl:font-bold rtl:tracking-normal',
          light ? 'text-white/85' : 'text-[var(--site-accent-text)]',
        )}
      >
        {kicker}
      </span>
      <h2 className="font-display text-[2.125rem] leading-tight font-bold sm:text-5xl rtl:leading-snug">
        {title}
      </h2>
      <span className="site-ornament mt-1" aria-hidden />
    </div>
  );
}

/** Élément qui apparaît en glissant quand il entre à l'écran. */
function Reveal({ className, children }: { className?: string; children: ReactNode }) {
  const reveal = useReveal<HTMLDivElement>();
  return (
    <div ref={reveal} className={cn('site-reveal', className)}>
      {children}
    </div>
  );
}

/** Photo de carte (ou fond dégradé de la palette sans photo). */
function CardPhoto({ photo, className }: { photo: PublicPhoto | null; className?: string }) {
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.thumbUrl}
      srcSet={`${photo.thumbUrl} 400w, ${photo.url} 1200w`}
      sizes="(min-width: 768px) 33vw, 70vw"
      alt=""
      loading="lazy"
      className={cn('size-full object-cover transition-transform duration-500', className)}
    />
  ) : (
    <span
      className={cn('block size-full', className)}
      style={{ background: 'linear-gradient(135deg, var(--primary), var(--site-accent))' }}
    />
  );
}

/** Bandeau plein écran : photo principale (zoom lent), nom, présentation, deux boutons. */
function Hero({
  photo,
  name,
  intro,
  city,
}: {
  photo: PublicPhoto | null;
  name: string;
  intro: string | null;
  city: string | null;
}) {
  const t = useTranslations('site.home');
  return (
    <section
      className="relative isolate flex min-h-[92vh] items-end overflow-hidden text-white supports-[height:100svh]:min-h-[92svh]"
      data-testid="site-hero"
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.url}
          alt=""
          fetchPriority="high"
          className="site-kenburns absolute inset-0 -z-20 size-full object-cover"
        />
      ) : (
        <span
          className="absolute inset-0 -z-20"
          style={{ background: 'linear-gradient(160deg, var(--primary), #1d120c)' }}
        />
      )}
      {/* Voile sombre, renforcé sous le texte : contraste du texte blanc quelle que soit la photo */}
      <span
        className="absolute inset-0 -z-10"
        style={{
          background:
            'linear-gradient(180deg, rgb(25 12 6 / 0.55) 0%, rgb(25 12 6 / 0.1) 28%, rgb(25 12 6 / 0.55) 55%, rgb(25 12 6 / 0.88) 100%)',
        }}
        aria-hidden
      />
      <div className="mx-auto w-full max-w-6xl px-4 pt-36 pb-16 sm:pb-20">
        {city && (
          <p className="flex items-center gap-2.5 text-xs font-extrabold tracking-[0.2em] text-[#f3dca8] uppercase rtl:text-[0.95rem] rtl:tracking-normal">
            <span className="h-px w-8 bg-current" aria-hidden />
            {city}
          </p>
        )}
        <h1
          className="site-page-title font-display mt-3 mb-4 max-w-[12ch] text-[2.875rem] leading-[1.02] font-bold [text-shadow:0_2px_24px_rgb(0_0_0/0.35)] sm:text-7xl lg:text-8xl rtl:leading-[1.3]"
          dir="auto"
        >
          {name}
        </h1>
        {intro && (
          <p
            className="mb-7 max-w-xl text-[1.0625rem] leading-relaxed whitespace-pre-line [text-shadow:0_1px_10px_rgb(0_0_0/0.5)] sm:text-xl"
            dir="auto"
          >
            {intro}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            asChild
            size="lg"
            className="h-13 rounded-full px-7 text-base shadow-[0_10px_30px_-10px_var(--primary)]"
          >
            <Link href="/demande">
              {t('requestQuote')}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-13 rounded-full border-white/70 bg-white/15 px-7 text-base text-white backdrop-blur-sm hover:bg-white hover:text-foreground"
          >
            <Link href="/catalogue">{t('seeCatalog')}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Carte d'un menu ou buffet mis en avant : photo, prix posé dessus, nom, invités, ajout. */
function FeaturedCard({ item }: { item: PublicFeatured }) {
  const t = useTranslations('site.home');
  const tu = useTranslations('site.catalog.units');
  const localized = useLocalized();
  const shown = useListShown();
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  const href = `/catalogue/${item.kind}/${item.id}`;
  const guests =
    item.maxGuests === null
      ? t('guestsFrom', { min: item.minGuests })
      : t('guestsRange', { min: item.minGuests, max: item.maxGuests });
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-[1.375rem] border bg-card transition-[transform,box-shadow] duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_50px_-24px_rgb(60_30_10/0.35)]">
      <Link
        href={href}
        className="relative block h-56 overflow-hidden sm:h-48 lg:h-52"
        tabIndex={-1}
      >
        <CardPhoto photo={item.photo} className="group-hover:scale-105" />
        <span className="absolute start-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-extrabold text-primary">
          {t(`kinds.${item.kind}`)}
          {item.range && shown(item.range) ? ` · ${localized(item.range.name)}` : ''}
        </span>
        <span className="absolute start-3 bottom-3 rounded-xl bg-white/95 px-3 py-1.5 text-xs leading-tight text-muted-foreground shadow-md">
          {t('from')}
          <b className="block text-xl font-extrabold text-primary" dir="auto">
            {formatMoney(item.priceTtc, locale)}
          </b>
          {item.perPerson ? tu('perPerson') : tu('flat')}
        </span>
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-4 sm:p-5">
        <h3 className="font-display text-[1.625rem] leading-tight font-bold">
          <Link href={href} className="hover:underline" dir="auto">
            {localized(item.name)}
          </Link>
        </h3>
        <p className="mb-4 flex-1 text-sm text-muted-foreground">{guests}</p>
        <AddToCartButton entry={item} className="h-11 w-full rounded-full" />
      </div>
    </article>
  );
}

/**
 * Accueil du site client : bandeau plein écran, types d'événement (vers le catalogue filtré),
 * menus phares, « Comment ça marche », galerie et contact. Carrousels sur téléphone, grilles sur
 * grand écran ; apparition au défilement, désactivée avec « réduire les animations ».
 */
export function SiteHome() {
  const t = useTranslations('site.home');
  const localized = useLocalized();
  const space = useSpace();
  const site = usePublicSite();
  const options = usePublicCatalogOptions();
  if (site.isPending) return <Skeleton className="h-[92vh] w-full rounded-none" />;
  const data = site.data;
  const name = data?.name ?? (space?.kind === 'traiteur' ? space.traiteur.name : '');
  const [hero = null, ...others] = data?.photos ?? [];
  const gallery = (others.length >= 2 ? others : (data?.photos ?? [])).slice(0, 5);
  const cards = (options.data?.eventTypes ?? []).map((type) => ({
    ...type,
    photo: data?.eventTypeCards.find((card) => card.code === type.code)?.photo ?? null,
  }));
  const featured = data?.featured ?? [];
  const steps = ['compose', 'quote', 'confirm'] as const;

  return (
    <div data-testid="site-home">
      <Hero
        photo={hero}
        name={name}
        intro={data?.intro ? localized(data.intro) : null}
        city={data?.city ?? null}
      />

      {cards.length > 0 && (
        <section className="py-16 sm:py-20" data-testid="site-event-types">
          <div className="mx-auto max-w-6xl px-4">
            <SectionHead kicker={t('eventTypes')} title={t('eventTypesTitle')} />
            <ul className="site-rail -mx-4 flex gap-3.5 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0">
              {cards.map((card) => (
                <li key={card.code} className="w-[64%] shrink-0 md:w-auto">
                  <Reveal>
                    <Link
                      href={`/catalogue?type=${card.code}`}
                      className="group relative block h-72 overflow-hidden rounded-2xl text-white md:h-60"
                      data-testid="event-type-card"
                    >
                      <CardPhoto photo={card.photo} className="group-hover:scale-[1.07]" />
                      <span
                        className="absolute inset-0 bg-gradient-to-b from-transparent from-35% to-[rgb(25_12_6/0.85)]"
                        aria-hidden
                      />
                      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
                        <span
                          className="font-display text-[1.75rem] leading-tight font-bold"
                          dir="auto"
                        >
                          {localized(card.name)}
                        </span>
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/95 text-primary transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1">
                          <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
                        </span>
                      </span>
                    </Link>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {featured.length > 0 && (
        <section className="pb-16 sm:pb-20" data-testid="site-featured">
          <div className="mx-auto max-w-6xl px-4">
            <SectionHead kicker={t('featured')} title={t('featuredTitle')} />
            <ul
              className={cn(
                'site-rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:gap-5 md:overflow-visible md:px-0',
                featured.length % 3 === 0 ? 'md:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-4',
              )}
            >
              {featured.map((item) => (
                <li key={`${item.kind}:${item.id}`} className="w-[80%] shrink-0 md:w-auto">
                  <Reveal className="h-full">
                    <FeaturedCard item={item} />
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <HomeRangeChooser />

      <section className="bg-[var(--site-sand)] py-16 sm:py-20" data-testid="site-how">
        <div className="mx-auto max-w-6xl px-4">
          <SectionHead kicker={t('how')} title={t('howTitle')} />
          <ol className="grid gap-3.5 md:grid-cols-3 md:gap-5">
            {steps.map((step, index) => (
              <li key={step}>
                <Reveal className="flex h-full gap-4 rounded-2xl border bg-card p-5 md:flex-col md:p-7">
                  <span
                    className="font-display w-12 shrink-0 text-5xl leading-[0.9] font-bold text-[var(--site-accent)]"
                    aria-hidden
                  >
                    {`0${index + 1}`}
                  </span>
                  <span>
                    <span className="mb-1 block text-lg font-extrabold">
                      {t(`steps.${step}.title`)}
                    </span>
                    <span className="text-muted-foreground">{t(`steps.${step}.text`)}</span>
                  </span>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {gallery.length >= 2 && (
        <section className="py-16 sm:py-20" data-testid="site-gallery">
          <div className="mx-auto max-w-6xl px-4">
            <SectionHead kicker={t('gallery')} title={t('galleryTitle')} />
            <Reveal>
              <ul
                className={cn(
                  'grid auto-rows-[150px] grid-cols-2 gap-2.5 md:auto-rows-[230px] md:gap-3.5',
                  GALLERY_COLUMNS[gallery.length],
                )}
              >
                {gallery.map((photo, index) => (
                  <li
                    key={photo.url}
                    className={cn(
                      'overflow-hidden rounded-xl',
                      // Grande photo sur deux rangées seulement si la grille reste pleine
                      index === 0 && gallery.length % 2 === 1 && 'row-span-2',
                      index === 0 && gallery.length !== 5 && 'md:row-span-1',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={index === 0 ? photo.url : photo.thumbUrl}
                      alt={t('photoAlt', { position: index + 1 })}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                    />
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>
      )}

      {data && (
        <section className="pb-16 sm:pb-20" data-testid="site-contact">
          <div className="mx-auto max-w-6xl px-4">
            <Reveal className="relative grid gap-6 overflow-hidden rounded-[1.75rem] bg-primary p-7 text-primary-foreground sm:p-12 md:grid-cols-[1.2fr_1fr] md:items-center">
              <span
                className="pointer-events-none absolute -end-16 -top-28 size-80 rounded-full border-[60px] border-white/[0.06]"
                aria-hidden
              />
              <div className="relative">
                <p className="text-xs font-extrabold tracking-[0.2em] text-[#f3dca8] uppercase rtl:text-[0.95rem] rtl:tracking-normal">
                  {t('contact')}
                </p>
                <h2 className="font-display mt-2 mb-2 text-[2.125rem] leading-tight font-bold sm:text-5xl rtl:leading-snug">
                  {t('contactTitle')}
                </h2>
                <p className="opacity-90">{t('contactText')}</p>
              </div>
              <div className="relative flex flex-col gap-5">
                <ul className="flex flex-col gap-3">
                  {data.city && (
                    <li className="flex items-center gap-2.5">
                      <MapPinIcon className="size-4 shrink-0" aria-hidden />
                      {data.city}
                    </li>
                  )}
                  <li className="flex items-center gap-2.5">
                    <PhoneIcon className="size-4 shrink-0" aria-hidden />
                    <a
                      href={`tel:${data.phone}`}
                      dir="ltr"
                      className="underline-offset-4 hover:underline"
                    >
                      {data.phone}
                    </a>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <MailIcon className="size-4 shrink-0" aria-hidden />
                    <a
                      href={`mailto:${data.email}`}
                      className="break-all underline-offset-4 hover:underline"
                    >
                      {data.email}
                    </a>
                  </li>
                </ul>
                <div className="flex flex-wrap gap-3">
                  {data.whatsappPhone && (
                    <a
                      href={whatsappUrl(data.whatsappPhone, t('whatsappMessage'))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-12 items-center gap-2 rounded-full bg-[#25d366] px-6 font-bold text-[#06301a]"
                    >
                      <WhatsAppIcon className="size-5" />
                      {t('whatsapp')}
                    </a>
                  )}
                  <a
                    href={`tel:${data.phone}`}
                    className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 font-bold text-primary"
                  >
                    <PhoneIcon className="size-4" aria-hidden />
                    {t('call')}
                  </a>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      )}
    </div>
  );
}
