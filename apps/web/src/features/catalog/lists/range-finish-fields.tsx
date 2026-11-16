'use client';

import { RANGE_FINISHES, RANGE_INCLUDED_MAX, type RangeFinish } from '@traiteur/shared';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RangeBadge } from '@/features/site/range-finish';
import { cn } from '@/lib/utils';

/**
 * Finition d'une gamme sur le site (ivoire, bronze, or) : cartes à choix unique, chacune avec
 * l'aperçu du badge (symbole et nom) et une phrase décrivant le style de carte.
 */
export function RangeFinishPicker({
  value,
  onChange,
  name,
}: {
  value: RangeFinish;
  onChange: (finish: RangeFinish) => void;
  /** Nom de la gamme, montré dans l'aperçu du badge. */
  name: string;
}) {
  const t = useTranslations('catalog.lists.finish');
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{t('label')}</legend>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
        {RANGE_FINISHES.map((finish) => (
          <button
            key={finish}
            type="button"
            role="radio"
            aria-checked={value === finish}
            onClick={() => onChange(finish)}
            className={cn(
              'grid justify-items-start gap-2 rounded-xl border p-3 text-start text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              value === finish && 'border-foreground ring-1 ring-foreground',
            )}
            data-testid={`finish-${finish}`}
          >
            <span className="flex items-center gap-2 text-sm font-bold text-foreground">
              <span
                aria-hidden
                className={cn(
                  'size-4 rounded-full border-[1.5px] border-muted-foreground',
                  value === finish && 'border-[5px] border-foreground',
                )}
              />
              {t(`names.${finish}`)}
            </span>
            <RangeBadge finish={finish} name={name || t(`names.${finish}`)} />
            <span>{t(`styles.${finish}`)}</span>
          </button>
        ))}
      </div>
      <p className="text-[13px] text-muted-foreground">{t('hint')}</p>
    </fieldset>
  );
}

/**
 * Liste « Ce qui est inclus » dans une langue : une ligne par élément, suppression et ajout
 * (12 lignes au plus). Les lignes vides sont ignorées à l'enregistrement.
 */
export function IncludedLinesField({
  label,
  language,
  value,
  onChange,
}: {
  label: string;
  language: 'fr' | 'ar';
  value: string[];
  onChange: (lines: string[]) => void;
}) {
  const t = useTranslations('catalog.lists.included');
  const id = `included-${language}`;
  return (
    <div className="grid content-start gap-2" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <ul className="grid gap-2" aria-labelledby={id}>
        {value.map((line, index) => (
          <li key={index} className="flex gap-2">
            <Input
              value={line}
              lang={language}
              dir={language === 'ar' ? 'rtl' : 'ltr'}
              maxLength={160}
              aria-label={t('line', { label, index: index + 1 })}
              onChange={(event) =>
                onChange(value.map((current, i) => (i === index ? event.target.value : current)))
              }
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('remove', { index: index + 1 })}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>
      {value.length < RANGE_INCLUDED_MAX && (
        <Button
          type="button"
          variant="outline"
          className="w-fit border-dashed"
          onClick={() => onChange([...value, ''])}
          data-testid={`included-add-${language}`}
        >
          <PlusIcon data-icon="inline-start" />
          {t('add')}
        </Button>
      )}
    </div>
  );
}
