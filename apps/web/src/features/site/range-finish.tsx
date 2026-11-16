'use client';

import { type PublicRange, RANGE_FINISH_COLORS, type RangeFinish } from '@traiteur/shared';
import { CheckIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';

import { useLocalized } from '@/features/catalog/use-localized';
import { cn } from '@/lib/utils';

/**
 * Symbole d'une finition : losange (ivoire), étoile marocaine à 8 branches (bronze), couronne
 * (or). Toujours accompagné du nom de la gamme : jamais la couleur seule.
 */
export function RangeSymbol({ finish, className }: { finish: RangeFinish; className?: string }) {
  const props = { viewBox: '0 0 24 24', 'aria-hidden': true, className: cn('size-3.5', className) };
  if (finish === 'ivory') {
    return (
      <svg
        {...props}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        data-symbol="diamond"
      >
        <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" />
        <path d="M12 8 16 12 12 16 8 12Z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (finish === 'bronze') {
    return (
      <svg {...props} fill="currentColor" data-symbol="star">
        <path d="M12 1.5l3 4.2 5.1-.8-.8 5.1 4.2 3-4.2 3 .8 5.1-5.1-.8-3 4.2-3-4.2-5.1.8.8-5.1-4.2-3 4.2-3-.8-5.1 5.1.8z" />
        <circle cx="12" cy="13" r="3.2" fill="#fff" opacity=".85" />
      </svg>
    );
  }
  return (
    <svg {...props} fill="currentColor" data-symbol="crown">
      <path d="M2.5 7.5 7 11l5-7 5 7 4.5-3.5L19.5 18h-15Z" />
      <rect x="4.5" y="19.3" width="15" height="2.2" rx="1" />
    </svg>
  );
}

/** Couleurs d'une finition en style en ligne (contraste vérifié par les tests partagés). */
function finishStyle(finish: RangeFinish): CSSProperties {
  const colors = RANGE_FINISH_COLORS[finish];
  return { color: colors.ink, backgroundColor: colors.background, borderColor: colors.border };
}

/** Badge d'une gamme : symbole et nom, aux couleurs de sa finition. */
export function RangeBadge({
  finish,
  name,
  className,
}: {
  finish: RangeFinish;
  name: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 w-fit items-center gap-1.5 rounded-full border ps-2.5 pe-3 text-[13px] font-extrabold tracking-wide',
        finish === 'gold' && 'range-badge-gold',
        className,
      )}
      style={finishStyle(finish)}
      data-testid="range-badge"
      data-finish={finish}
    >
      <RangeSymbol finish={finish} className="shrink-0" />
      <span dir="auto">{name}</span>
    </span>
  );
}

/** Rond coloré portant le symbole (comparateur, filtres, suggestion). */
export function RangeMark({
  finish,
  size = 'md',
}: {
  finish: RangeFinish;
  size?: 'sm' | 'md' | 'lg';
}) {
  const colors = RANGE_FINISH_COLORS[finish];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border',
        finish === 'gold' && 'range-badge-gold',
        size === 'sm' ? 'size-6' : size === 'md' ? 'size-8' : 'size-11',
      )}
      style={{
        color: colors.symbol,
        backgroundColor: colors.background,
        borderColor: colors.border,
      }}
    >
      <RangeSymbol finish={finish} className={size === 'lg' ? 'size-[22px]' : 'size-4'} />
    </span>
  );
}

/** Badge d'une gamme du catalogue public (nom traduit). */
export function PublicRangeBadge({ range, className }: { range: PublicRange; className?: string }) {
  const localized = useLocalized();
  return <RangeBadge finish={range.finish} name={localized(range.name)} className={className} />;
}

/** Lignes de « Ce qui est inclus » dans la langue du site (repli : français). */
export function useIncludedLines(): (range: PublicRange) => string[] {
  const locale = useLocale();
  return (range) =>
    locale === 'ar' && range.included.ar.length > 0 ? range.included.ar : range.included.fr;
}

/** Ligne d'introduction (« Tout l'Essentiel, et : ») : se termine par deux-points, sans coche. */
export function isLeadLine(line: string): boolean {
  return /[:：]s*$/.test(line);
}

/** Liste « inclus » avec coches dans la couleur de la finition. */
export function IncludedList({
  range,
  limit,
  className,
}: {
  range: PublicRange;
  limit?: number;
  className?: string;
}) {
  const all = useIncludedLines()(range);
  // Carte (liste abrégée) : les vrais éléments seulement, sans « Tout l'Essentiel, et : »
  const lines = limit === undefined ? all : all.filter((line) => !isLeadLine(line)).slice(0, limit);
  if (lines.length === 0) return null;
  return (
    <ul className={cn('grid gap-1 text-sm', className)} data-testid="range-included">
      {lines.map((line, index) =>
        isLeadLine(line) ? (
          <li key={index} className="font-bold text-muted-foreground" dir="auto">
            {line}
          </li>
        ) : (
          <li key={index} className="flex items-start gap-2" dir="auto">
            <CheckIcon
              className="mt-[3px] size-4 shrink-0"
              style={{ color: RANGE_FINISH_COLORS[range.finish].symbol }}
              aria-hidden
            />
            <span>{line}</span>
          </li>
        ),
      )}
    </ul>
  );
}

/** Encart « Inclus dans la gamme X » des fiches, à la finition de la gamme. */
export function IncludedPanel({ range }: { range: PublicRange }) {
  const t = useTranslations('site.ranges');
  const localized = useLocalized();
  if (useIncludedLines()(range).length === 0) return null;
  return (
    <section
      className="range-panel rounded-2xl p-5"
      data-finish={range.finish}
      data-testid="included-panel"
    >
      <h2 className="mb-2 flex items-center gap-2 text-[17px] font-extrabold">
        <RangeMark finish={range.finish} />
        {t('includedIn', { name: localized(range.name) })}
      </h2>
      <IncludedList range={range} className="gap-1.5 text-[15px]" />
    </section>
  );
}
