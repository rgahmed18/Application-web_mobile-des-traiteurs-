'use client';

import type { PublicCatalog, PublicListItem, PublicMenu } from '@traiteur/shared';
import { ArrowLeftIcon, CheckIcon, ImageIcon, ScaleIcon, SparklesIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

import { EmptyState } from '@/components/layout/list-states';
import { LoadError } from '@/components/layout/load-error';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalized } from '@/features/catalog/use-localized';
import { formatMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';

import { formatEstimate, menuForEvent } from './cart-estimate';
import { cartStore, useCart, useGuests } from './cart-store';
import { GuestsInput } from './guests-input';
import {
  comparableEventTypes,
  compareRanges,
  estimateTotal,
  highlightFirst,
  type RangeColumn,
} from './range-compare';
import { IncludedList, RangeMark } from './range-finish';
import { usePublicCatalog, usePublicCatalogOptions, usePublicSite } from './site-api';
import { useReveal } from './use-reveal';

/** Code d'un type d'événement accepté dans l'adresse. */
const CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

/** Montant arrondi à la centaine de dirhams, sans décimales : « 28 000 MAD », « 28 000 د.م. ». */
function useRoundMoney(): (cents: number) => string {
  // Même arrondi que « Ma demande » et les fiches
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  return (cents) => formatEstimate(cents, locale, formatMoney);
}

function useMoney(): (cents: number) => string {
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  return (cents) => formatMoney(cents, locale);
}

/** Données du comparateur : gammes, catalogue publié, événements comparables, gamme mise en avant. */
function useComparatorData() {
  const options = usePublicCatalogOptions();
  const catalog = usePublicCatalog();
  const site = usePublicSite();
  const ranges = options.data?.ranges ?? [];
  const types = options.data?.eventTypes ?? [];
  const comparable =
    options.data && catalog.data
      ? comparableEventTypes(
          catalog.data,
          ranges,
          types.map((item) => item.code),
        )
      : [];
  return {
    pending: options.isPending || catalog.isPending,
    error: options.error ?? catalog.error,
    catalog: catalog.data ?? null,
    ranges,
    types,
    comparable,
    highlight: site.data?.highlightRange ?? null,
  };
}

/** « Ma demande » contient déjà ce choix (menu de la gamme, ou gamme sur demande). */
function useChosen(column: RangeColumn): boolean {
  const cart = useCart();
  const { menu, range } = column;
  return menu
    ? cart.some((item) => item.kind === 'menu' && item.id === menu.id)
    : cart.some((item) => item.kind === 'range' && item.id === range.code);
}

/** Ajout d'une gamme à « Ma demande » : son menu, ou la gamme sur demande. */
function addToCart(column: RangeColumn): void {
  if (column.menu) cartStore.add('menu', column.menu.id);
  else cartStore.addRange(column.range.code);
}

/** Choix d'une gamme par les cartes et la barre fixe (fenêtre de remplacement au besoin). */
const ChooseContext = createContext<(column: RangeColumn) => void>(addToCart);

/**
 * Choix d'une gamme pour un événement : si « Ma demande » a déjà une formule pour cet événement,
 * fenêtre « Vous avez déjà la … La remplacer par la … ? » : Remplacer, ou Garder les deux.
 */
function useChooser(eventType: string | null, catalog: PublicCatalog | null) {
  const t = useTranslations('site.compare');
  const localized = useLocalized();
  const cart = useCart();
  const [pending, setPending] = useState<{ column: RangeColumn; existing: PublicMenu } | null>(
    null,
  );
  const choose = (column: RangeColumn) => {
    if (column.menu && eventType && catalog) {
      const cartMenus = catalog.menus.filter((menu) =>
        cart.some((item) => item.kind === 'menu' && item.id === menu.id),
      );
      const existing = menuForEvent(cartMenus, eventType, column.menu.id);
      if (existing) {
        setPending({ column, existing });
        return;
      }
    }
    addToCart(column);
  };
  const next = pending?.column.menu;
  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent data-testid="replace-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('replaceTitle')}</AlertDialogTitle>
          <AlertDialogDescription dir="auto">
            {pending && next
              ? t('replaceText', {
                  current: localized(pending.existing.name),
                  next: localized(next.name),
                })
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => pending && addToCart(pending.column)}
            data-testid="keep-both"
          >
            {t('keepBoth')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              pending && next && cartStore.replace('menu', pending.existing.id, next.id)
            }
            data-testid="replace-menu"
          >
            {t('replace')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { choose, dialog };
}

/** Onglets des types d'événement (seulement ceux qui ont un comparateur). */
function EventTabs({
  codes,
  types,
  value,
  onChange,
}: {
  codes: string[];
  types: PublicListItem[];
  value: string;
  onChange: (code: string) => void;
}) {
  const t = useTranslations('site.compare');
  const localized = useLocalized();
  return (
    <div
      role="tablist"
      aria-label={t('eventTabs')}
      className="site-rail -mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 md:flex-wrap"
      data-testid="compare-event-tabs"
    >
      {codes.map((code) => {
        const item = types.find((type) => type.code === code);
        return (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={code === value}
            onClick={() => onChange(code)}
            className={cn(
              'inline-flex h-[42px] shrink-0 items-center rounded-full border px-4 text-[15px] font-semibold whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              code === value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-[#ddd0bc] bg-card hover:border-primary',
            )}
          >
            {item ? localized(item.name) : code}
          </button>
        );
      })}
    </div>
  );
}

/** Nombre d'invités de la demande, pour l'estimation du total de chaque gamme. */
function GuestsBox() {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <GuestsInput />
    </div>
  );
}

/** Tête de carte : photo réelle du menu, sinon son illustration ; « sur demande » : ornement. */
function CardPhoto({ column }: { column: RangeColumn }) {
  const t = useTranslations('site.catalog');
  const localized = useLocalized();
  const photo = column.menu?.thumbUrl ?? column.menu?.imageUrl ?? null;
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-t-[20px] bg-[var(--site-sand)]">
      {photo && column.menu ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={t('photoOf', { name: localized(column.menu.name) })}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : column.menu ? (
        <span className="flex size-full items-center justify-center">
          <ImageIcon className="size-10 text-muted-foreground" aria-hidden />
        </span>
      ) : (
        <span className="relative flex size-full items-center justify-center" aria-hidden>
          <span className="site-zellige-full absolute inset-0 opacity-70" />
          <RangeMark finish={column.range.finish} size="lg" />
        </span>
      )}
    </div>
  );
}

/**
 * Carte d'une gamme pour un type d'événement, à la finition de la gamme : photo, nom, menu, prix
 * par personne et estimation du total, plats, ce qui est inclus ; « Choisir cette gamme » (menu
 * ajouté à « Ma demande » avec le nombre d'invités) ou, sans menu, « Sur demande ».
 */
function RangeCard({
  column,
  guests,
  highlighted,
  index,
}: {
  column: RangeColumn;
  guests: number | null;
  highlighted: boolean;
  index: number;
}) {
  const choose = useContext(ChooseContext);
  const t = useTranslations('site.compare');
  const localized = useLocalized();
  const money = useMoney();
  const roundMoney = useRoundMoney();
  const reveal = useReveal<HTMLElement>();
  const chosen = useChosen(column);
  const { range, menu } = column;
  const estimate = guests === null ? null : estimateTotal(column, guests);
  const outOfRange =
    menu !== null &&
    guests !== null &&
    (guests < menu.minGuests || (menu.maxGuests !== null && guests > menu.maxGuests));

  return (
    <article
      ref={reveal}
      className={cn(
        'range-card site-reveal relative flex w-full flex-col rounded-[22px] border bg-card',
        highlighted && 'range-card-highlight',
      )}
      style={{ transitionDelay: `${index * 90}ms` }}
      data-finish={range.finish}
      data-range={range.code}
      data-testid="compare-card"
      aria-label={localized(range.name)}
    >
      {highlighted && (
        <span
          className="absolute end-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-extrabold text-primary-foreground shadow-md"
          data-testid="most-chosen"
        >
          <SparklesIcon className="size-3.5" aria-hidden />
          {t('mostChosen')}
        </span>
      )}
      <CardPhoto column={column} />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center gap-2.5">
          <RangeMark finish={range.finish} />
          <h3
            className={cn(
              'font-display text-[28px] leading-tight font-bold rtl:leading-normal',
              range.finish === 'gold' && 'range-title-gold',
            )}
            dir="auto"
          >
            {localized(range.name)}
          </h3>
        </div>
        {range.description && (
          <p className="text-sm text-muted-foreground" dir="auto">
            {localized(range.description)}
          </p>
        )}
        {menu ? (
          <Link
            href={`/catalogue/menu/${menu.id}`}
            className={cn(
              'font-display text-[24px] leading-snug font-bold hover:underline rtl:leading-normal',
              range.finish === 'gold' && 'range-title-gold',
            )}
            dir="auto"
            data-testid="compare-menu"
          >
            {localized(menu.name)}
          </Link>
        ) : (
          <p className="font-bold" data-testid="on-request">
            {t('onRequestTitle')}
          </p>
        )}
        <div className="border-y py-3">
          {column.fromPrice !== null ? (
            <>
              <p className="text-2xl font-extrabold" dir="auto">
                {money(column.fromPrice)}{' '}
                <span className="text-sm font-medium text-muted-foreground">{t('perPerson')}</span>
              </p>
              {estimate !== null && guests !== null && (
                <p className="text-sm font-semibold" data-testid="compare-estimate" dir="auto">
                  {t('estimate', { total: roundMoney(estimate), count: guests })}
                </p>
              )}
              {outOfRange && (
                <p
                  className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900"
                  data-testid="guests-warning"
                >
                  {menu.maxGuests
                    ? t('guestsLimits', { min: menu.minGuests, max: menu.maxGuests })
                    : t('guestsMin', { min: menu.minGuests })}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-2xl font-extrabold" data-testid="on-request-price">
                {t('onRequest')}
              </p>
              <p className="text-sm text-muted-foreground">{t('onRequestHint')}</p>
            </>
          )}
          {column.dishes && (
            <p className="mt-1 text-sm text-muted-foreground">
              {column.dishes.min === column.dishes.max
                ? t('dishes', { count: column.dishes.max })
                : t('dishRange', { min: column.dishes.min, max: column.dishes.max })}
            </p>
          )}
        </div>
        <IncludedList range={range} className="gap-1.5 text-[15px]" />
        <div className="mt-auto flex flex-col gap-2 pt-2">
          {chosen ? (
            <Button asChild variant="secondary" className="h-12 rounded-full text-base">
              <Link href="/demande" data-testid="compare-in-cart">
                <CheckIcon data-icon="inline-start" />
                {t('inCart')}
              </Link>
            </Button>
          ) : (
            <Button
              className="h-12 rounded-full text-base"
              onClick={() => choose(column)}
              data-testid={menu ? 'choose-range' : 'request-range'}
            >
              {menu ? t('choose') : t('requestRange')}
            </Button>
          )}
          {menu && (
            <Button asChild variant="ghost" className="h-10 rounded-full">
              <Link href={`/catalogue/menu/${menu.id}`}>{t('seeMenu')}</Link>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Cartes des gammes : grille sur grand écran (Essentiel → Premium → Luxe) ; carrousel sur
 * téléphone, gamme mise en avant en premier, avec sa position (points). `onCurrent` : code de
 * la gamme affichée sur téléphone (barre fixe du comparateur).
 */
function RangeCards({
  columns,
  guests,
  highlight,
  onCurrent,
}: {
  columns: RangeColumn[];
  guests: number | null;
  highlight: string | null;
  onCurrent?: (code: string) => void;
}) {
  const t = useTranslations('site.compare');
  const rail = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const phone = highlightFirst(columns, highlight);
  const codes = phone.map((column) => column.range.code);
  const key = codes.join(',');
  // Dernière liste vue par le gestionnaire de défilement (sans le réabonner à chaque rendu)
  const latest = useRef({ codes, onCurrent });
  useEffect(() => {
    latest.current = { codes, onCurrent };
  });
  useEffect(() => {
    const first = latest.current.codes[0];
    if (first) latest.current.onCurrent?.(first);
    const element = rail.current;
    if (!element) return;
    element.scrollTo({ left: 0 });
    const update = () => {
      const width = element.firstElementChild?.clientWidth ?? element.clientWidth;
      const { codes: list, onCurrent: report } = latest.current;
      const index = Math.min(list.length - 1, Math.round(Math.abs(element.scrollLeft) / width));
      setCurrent(index);
      const code = list[index];
      if (code) report?.(code);
    };
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
  }, [key]);

  return (
    <>
      <div className="hidden gap-5 md:grid md:grid-cols-3" data-testid="compare-grid">
        {columns.map((column, index) => (
          <RangeCard
            key={column.range.code}
            column={column}
            guests={guests}
            highlighted={column.range.code === highlight}
            index={index}
          />
        ))}
      </div>
      <div className="md:hidden">
        <div
          ref={rail}
          className="site-rail -mx-4 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pt-1.5 pb-4"
          data-testid="compare-cards"
          role="region"
          aria-label={t('caption')}
        >
          {phone.map((column, index) => (
            <div key={column.range.code} className="flex w-[86%] shrink-0 snap-center">
              <RangeCard
                column={column}
                guests={guests}
                highlighted={column.range.code === highlight}
                index={index}
              />
            </div>
          ))}
        </div>
        <p
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
          aria-live="polite"
          data-testid="compare-position"
        >
          {phone.map((column, index) => (
            <span
              key={column.range.code}
              aria-hidden
              className={cn(
                'h-2 rounded-full transition-all',
                index === current ? 'w-5 bg-primary' : 'w-2 bg-[#d8cbb6]',
              )}
            />
          ))}
          <span className="ms-1">{t('swipe', { index: current + 1, total: phone.length })}</span>
        </p>
      </div>
    </>
  );
}

/**
 * Barre fixe du téléphone : « Choisir Premium — 360,00 MAD / pers. » pour la gamme affichée.
 * Le bouton WhatsApp remonte au-dessus tant qu'elle est là.
 */
function ChooseBar({ column }: { column: RangeColumn }) {
  const choose = useContext(ChooseContext);
  const t = useTranslations('site.compare');
  const localized = useLocalized();
  const money = useMoney();
  const chosen = useChosen(column);
  useEffect(() => {
    document.documentElement.setAttribute('data-bottom-bar', '');
    return () => document.documentElement.removeAttribute('data-bottom-bar');
  }, []);
  const name = localized(column.range.name);
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] md:hidden"
      data-testid="choose-bar"
    >
      {chosen ? (
        <Button
          asChild
          variant="secondary"
          size="lg"
          className="h-12 w-full rounded-full text-base"
        >
          <Link href="/demande">
            <CheckIcon data-icon="inline-start" />
            {t('inCartRange', { range: name })}
          </Link>
        </Button>
      ) : (
        <Button
          size="lg"
          className="h-12 w-full rounded-full text-base"
          onClick={() => choose(column)}
        >
          <span dir="auto">
            {column.fromPrice !== null
              ? t('chooseBar', { range: name, price: money(column.fromPrice) })
              : t('requestBar', { range: name })}
          </span>
        </Button>
      )}
    </div>
  );
}

/**
 * Section de l'accueil « Choisissez votre gamme » : onglets par événement, cartes des gammes avec
 * estimation, lien vers le comparateur complet. Masquée s'il n'y a aucun comparateur.
 */
export function HomeRangeChooser() {
  const t = useTranslations('site.compare');
  const data = useComparatorData();
  const [selected, setSelected] = useState<string | null>(null);
  const guests = useGuests();
  const eventType =
    selected && data.comparable.includes(selected) ? selected : (data.comparable[0] ?? null);
  const chooser = useChooser(eventType, data.catalog);
  if (!data.catalog || !eventType) return null;
  const columns = compareRanges(data.catalog, data.ranges, eventType);
  return (
    <section className="py-16 md:py-20" data-testid="home-ranges">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4">
        <div className="text-center">
          <p className="text-xs font-extrabold tracking-[0.2em] text-[var(--site-accent-text)] uppercase rtl:text-sm rtl:tracking-normal">
            {t('homeKicker')}
          </p>
          <h2 className="mt-2 font-display text-[34px] leading-tight font-bold md:text-5xl rtl:leading-normal">
            {t('homeTitle')}
          </h2>
          <div aria-hidden className="site-ornament mx-auto mt-3" />
        </div>
        <EventTabs
          codes={data.comparable}
          types={data.types}
          value={eventType}
          onChange={setSelected}
        />
        <GuestsBox />
        <ChooseContext.Provider value={chooser.choose}>
          <RangeCards columns={columns} guests={guests} highlight={data.highlight} />
        </ChooseContext.Provider>
        {chooser.dialog}
        {guests !== null && (
          <p className="text-center text-sm text-muted-foreground">{t('estimateNote')}</p>
        )}
        <Button asChild variant="outline" className="h-12 self-center rounded-full px-6">
          <Link href={`/catalogue/comparer?type=${eventType}`} data-testid="home-compare-link">
            {t('seeFull')}
          </Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * Comparateur de gammes (page) : onglets par type d'événement (seulement ceux qui ont au moins
 * un menu publié), nombre d'invités, cartes Essentiel → Premium → Luxe (gamme sans menu « sur
 * demande »), estimation du total ; sur téléphone, carrousel et barre fixe « Choisir … ».
 */
export function RangeComparator() {
  const t = useTranslations('site.compare');
  const tCatalog = useTranslations('site.catalog');
  const localized = useLocalized();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const data = useComparatorData();
  const guests = useGuests();
  const [current, setCurrent] = useState<string | null>(null);
  const requestedType = params.get('type') ?? '';
  const pageType =
    CODE.test(requestedType) && data.comparable.includes(requestedType)
      ? requestedType
      : (data.comparable[0] ?? null);
  const chooser = useChooser(pageType, data.catalog);

  if (data.pending) return <Skeleton className="h-[32rem] w-full" />;
  if (!data.catalog) return <LoadError error={data.error} backHref="/catalogue" />;
  const eventType = pageType;
  const columns = eventType ? compareRanges(data.catalog, data.ranges, eventType) : [];
  const eventName = data.types.find((item) => item.code === eventType);
  const bar = columns.find((column) => column.range.code === current);

  return (
    <div className="flex flex-col gap-3 pb-24 md:pb-10" data-testid="range-comparator">
      <Button variant="link" asChild className="self-start px-0">
        <Link href="/catalogue">
          <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
          {tCatalog('backToCatalog')}
        </Link>
      </Button>
      <p className="mt-2 flex items-center gap-2.5 text-xs font-extrabold tracking-[0.2em] text-[var(--site-accent-text)] uppercase before:h-px before:w-7 before:bg-current rtl:text-sm rtl:tracking-normal">
        {t('kicker')}
      </p>
      <h1 className="site-page-title font-display text-[36px] leading-tight font-bold md:text-5xl rtl:leading-normal">
        {eventName ? t('title', { event: localized(eventName.name) }) : t('kicker')}
      </h1>
      <p className="text-muted-foreground">{t('lead')}</p>
      {!eventType ? (
        <EmptyState icon={ScaleIcon} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          <EventTabs
            codes={data.comparable}
            types={data.types}
            value={eventType}
            onChange={(code) => router.replace(`${pathname}?type=${code}`, { scroll: false })}
          />
          <GuestsBox />
          <ChooseContext.Provider value={chooser.choose}>
            <RangeCards
              columns={columns}
              guests={guests}
              highlight={data.highlight}
              onCurrent={setCurrent}
            />
            {bar && <ChooseBar column={bar} />}
          </ChooseContext.Provider>
          {chooser.dialog}
          {guests !== null && (
            <p className="text-center text-sm text-muted-foreground" data-testid="estimate-note">
              {t('estimateNote')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
