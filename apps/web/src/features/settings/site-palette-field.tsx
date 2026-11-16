'use client';

import { SITE_PALETTE_CODES, SITE_PALETTES, type SitePaletteCode } from '@traiteur/shared';
import { CheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * Palette du site client : 6 palettes harmonieuses au contraste vérifié (texte blanc sur la
 * couleur principale, textes d'accent sur les fonds clairs). Aperçu : bouton et petit titre.
 */
export function SitePaletteField({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: SitePaletteCode) => void;
}) {
  const t = useTranslations('settings.site.palette');
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">{t('label')}</legend>
      <div
        role="radiogroup"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        data-testid="site-palettes"
      >
        {SITE_PALETTE_CODES.map((code) => {
          const palette = SITE_PALETTES[code];
          const checked = code === value;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(code)}
              data-testid={`palette-${code}`}
              className={cn(
                'relative flex flex-col gap-2 rounded-xl border-2 p-3 text-start transition-colors',
                checked
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-border hover:border-muted-foreground/40',
              )}
              style={{ background: palette.background }}
            >
              <span
                className="text-xs font-bold tracking-wide uppercase"
                style={{ color: palette.accentText }}
              >
                {t(`names.${code}`)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-7 flex-1 rounded-full" style={{ background: palette.primary }} />
                <span className="size-5 rounded-full" style={{ background: palette.accent }} />
                <span className="size-5 rounded-full border" style={{ background: palette.sand }} />
              </span>
              {checked && (
                <CheckIcon
                  className="absolute end-2 top-2 size-4 rounded-full bg-primary p-0.5 text-primary-foreground"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
    </fieldset>
  );
}
