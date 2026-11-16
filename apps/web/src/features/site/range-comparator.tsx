'use client';

import { ArrowLeftIcon, ScaleIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { EmptyState } from '@/components/layout/list-states';
import { LoadError } from '@/components/layout/load-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalized } from '@/features/catalog/use-localized';
import { formatMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';

import { comparableEventTypes, compareRanges, type RangeColumn } from './range-compare';
import { IncludedList, RangeMark } from './range-finish';
import { usePublicCatalog, usePublicCatalogOptions } from './site-api';

/** Code d'un type d'événement accepté dans l'adresse. */
const CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

function useMoney(): (cents: number) => string {
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  return (cents) => formatMoney(cents, locale);
}

/** En-tête d'une gamme : grand symbole, nom (calligraphié pour l'or), description. */
function RangeHeading({ column }: { column: RangeColumn }) {
  const localized = useLocalized();
  const { range } = column;
  return (
    <div className="flex flex-col gap-2">
      <RangeMark finish={range.finish} size="lg" />
      <h2
        className={cn(
          'font-display text-[30px] leading-tight font-bold rtl:leading-normal',
          range.finish === 'gold' && 'range-title-gold',
        )}
        dir="auto"
      >
        {localized(range.name)}
      </h2>
      {range.description && (
        <p className="text-sm text-muted-foreground" dir="auto">
          {localized(range.description)}
        </p>
      )}
    </div>
  );
}

/** Menu proposé dans la gamme : vignette et nom. */
function ColumnMenu({ column }: { column: RangeColumn }) {
  const localized = useLocalized();
  return (
    <span className="flex items-center gap-3 font-bold" dir="auto">
      {column.menu.thumbUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={column.menu.thumbUrl}
          alt=""
          className="h-12 w-16 shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
      )}
      {localized(column.menu.name)}
    </span>
  );
}

function DishCount({ column }: { column: RangeColumn }) {
  const t = useTranslations('site.compare');
  const { min, max } = column.dishes;
  return (
    <span className="text-xl font-extrabold">
      {min === max ? t('dishes', { count: max }) : t('dishRange', { min, max })}
    </span>
  );
}

function SeeMenu({ column }: { column: RangeColumn }) {
  const t = useTranslations('site.compare');
  return (
    <Button
      asChild
      variant={column.range.finish === 'gold' ? 'default' : 'outline'}
      className="h-11 w-full rounded-full"
    >
      <Link href={`/catalogue/menu/${column.menu.id}`}>{t('seeMenu')}</Link>
    </Button>
  );
}

/** Tableau du grand écran : une colonne par gamme, une ligne par critère. */
function CompareTable({ columns }: { columns: RangeColumn[] }) {
  const t = useTranslations('site.compare');
  const money = useMoney();
  const cell = (column: RangeColumn, extra?: string) =>
    cn('range-panel border-x border-t px-5 py-4 align-top', extra);
  const rows: { label: string; render: (column: RangeColumn) => React.ReactNode }[] = [
    { label: t('menu'), render: (column) => <ColumnMenu column={column} /> },
    {
      label: t('from'),
      render: (column) => (
        <span className="text-2xl font-extrabold">
          {money(column.fromPrice)}{' '}
          <span className="text-sm font-medium text-muted-foreground">{t('perPerson')}</span>
        </span>
      ),
    },
    { label: t('dishCount'), render: (column) => <DishCount column={column} /> },
    {
      label: t('included'),
      render: (column) => <IncludedList range={column.range} className="gap-1.5 text-[15px]" />,
    },
  ];
  return (
    <table
      className="hidden w-full table-fixed border-separate border-spacing-x-3.5 md:table"
      data-testid="compare-table"
    >
      <caption className="sr-only">{t('caption')}</caption>
      <thead>
        <tr>
          <td className="w-44" />
          {columns.map((column) => (
            <th
              key={column.range.code}
              scope="col"
              className={cell(column, 'rounded-t-3xl pt-6 text-start font-normal')}
              data-finish={column.range.finish}
            >
              <RangeHeading column={column} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th
              scope="row"
              className="border-t px-0 py-4 text-start align-top text-[13px] font-extrabold tracking-wider text-muted-foreground uppercase rtl:text-sm rtl:tracking-normal"
            >
              {row.label}
            </th>
            {columns.map((column) => (
              <td
                key={column.range.code}
                className={cell(column)}
                data-finish={column.range.finish}
              >
                {row.render(column)}
              </td>
            ))}
          </tr>
        ))}
        <tr>
          <td />
          {columns.map((column) => (
            <td
              key={column.range.code}
              className={cell(column, 'rounded-b-3xl border-b pb-5')}
              data-finish={column.range.finish}
            >
              <SeeMenu column={column} />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** Téléphone : une carte par gamme, que l'on fait glisser, avec sa position (1 / 3). */
function CompareCards({ columns }: { columns: RangeColumn[] }) {
  const t = useTranslations('site.compare');
  const money = useMoney();
  const rail = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const update = () => {
      const width = element.firstElementChild?.clientWidth ?? element.clientWidth;
      setCurrent(Math.min(columns.length - 1, Math.round(Math.abs(element.scrollLeft) / width)));
    };
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
  }, [columns.length]);
  return (
    <div className="md:hidden">
      <div
        ref={rail}
        className="site-rail -mx-4 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pt-1.5 pb-4"
        data-testid="compare-cards"
        aria-label={t('caption')}
        role="region"
      >
        {columns.map((column, index) => (
          <article
            key={column.range.code}
            className="range-panel flex w-[84%] shrink-0 snap-center flex-col gap-3 rounded-3xl border bg-card p-5"
            data-finish={column.range.finish}
            aria-label={t('position', { index: index + 1, total: columns.length })}
          >
            <RangeHeading column={column} />
            <ColumnMenu column={column} />
            <dl className="grid grid-cols-2 gap-3 border-y py-3">
              <div>
                <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase rtl:text-sm rtl:tracking-normal">
                  {t('from')}
                </dt>
                <dd className="text-xl font-extrabold">{money(column.fromPrice)}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase rtl:text-sm rtl:tracking-normal">
                  {t('dishCount')}
                </dt>
                <dd>
                  <DishCount column={column} />
                </dd>
              </div>
            </dl>
            <IncludedList range={column.range} className="gap-1.5 text-[15px]" />
            <div className="mt-auto pt-2">
              <SeeMenu column={column} />
            </div>
          </article>
        ))}
      </div>
      <p
        className="mb-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"
        aria-live="polite"
      >
        {columns.map((column, index) => (
          <span
            key={column.range.code}
            aria-hidden
            className={cn(
              'h-2 rounded-full transition-all',
              index === current ? 'w-5 bg-primary' : 'w-2 bg-[#d8cbb6]',
            )}
          />
        ))}
        <span className="ms-1">{t('swipe', { index: current + 1, total: columns.length })}</span>
      </p>
    </div>
  );
}

/**
 * Comparateur de gammes pour un type d'événement : prix « à partir de », nombre de plats et
 * « Ce qui est inclus » de chaque gamme, côte à côte (tableau sur grand écran, cartes à faire
 * glisser sur téléphone). Type choisi dans l'adresse (?type=WEDDING), modifiable en pastilles.
 */
export function RangeComparator() {
  const t = useTranslations('site.compare');
  const tCatalog = useTranslations('site.catalog');
  const localized = useLocalized();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const options = usePublicCatalogOptions();
  const catalog = usePublicCatalog();

  if (options.isPending || catalog.isPending) return <Skeleton className="h-[32rem] w-full" />;
  if (!options.data || !catalog.data) {
    return <LoadError error={options.error ?? catalog.error} backHref="/catalogue" />;
  }
  const ranges = options.data.ranges;
  const types = options.data.eventTypes;
  const comparable = comparableEventTypes(
    catalog.data,
    ranges,
    types.map((item) => item.code),
  );
  const requested = params.get('type') ?? '';
  const eventType =
    CODE.test(requested) && comparable.includes(requested) ? requested : comparable[0];
  const columns = eventType ? compareRanges(catalog.data, ranges, eventType) : [];
  const eventName = types.find((item) => item.code === eventType);

  return (
    <div className="flex flex-col gap-2 pb-10" data-testid="range-comparator">
      <Button variant="link" asChild className="self-start px-0">
        <Link href="/catalogue">
          <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
          {tCatalog('backToCatalog')}
        </Link>
      </Button>
      <p className="mt-2 flex items-center gap-2.5 text-xs font-extrabold tracking-[0.2em] text-[var(--site-accent-text)] uppercase before:h-px before:w-7 before:bg-current rtl:text-sm rtl:tracking-normal">
        {t('kicker')}
      </p>
      <h1 className="font-display text-[36px] leading-tight font-bold md:text-5xl rtl:leading-normal">
        {eventName ? t('title', { event: localized(eventName.name) }) : t('kicker')}
      </h1>
      <p className="text-muted-foreground">{t('lead')}</p>
      {comparable.length === 0 || !eventType ? (
        <EmptyState icon={ScaleIcon} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          <div
            role="group"
            aria-label={tCatalog('filters.eventType')}
            className="site-rail -mx-4 my-3 flex gap-2 overflow-x-auto px-4 py-0.5"
          >
            {comparable.map((code) => {
              const item = types.find((type) => type.code === code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={code === eventType}
                  onClick={() => router.replace(`${pathname}?type=${code}`, { scroll: false })}
                  className={cn(
                    'inline-flex h-[42px] shrink-0 items-center rounded-full border px-4 text-[15px] font-semibold whitespace-nowrap focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    code === eventType
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-[#ddd0bc] bg-card hover:border-primary',
                  )}
                >
                  {item ? localized(item.name) : code}
                </button>
              );
            })}
          </div>
          <CompareTable columns={columns} />
          <CompareCards columns={columns} />
        </>
      )}
    </div>
  );
}
