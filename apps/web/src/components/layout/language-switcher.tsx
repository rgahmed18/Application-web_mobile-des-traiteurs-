'use client';

import { LanguagesIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { setLocale } from '@/i18n/actions';
import { LOCALE_LABELS, UI_LOCALES } from '@/i18n/config';
import { cn } from '@/lib/utils';

/**
 * Bascule français / arabe : un seul bouton qui affiche l'autre langue, dans sa propre langue.
 * La page est ré-affichée côté serveur (sens d'écriture, polices, textes). `onDark` : sur une barre
 * foncée (console), contour et texte clairs, contrastés au repos, au survol et au focus.
 */
export function LanguageSwitcher({
  onDark = false,
  pill = false,
}: {
  onDark?: boolean;
  /** Petite pastille discrète (site client). */
  pill?: boolean;
}) {
  const t = useTranslations('language');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const other = UI_LOCALES.find((candidate) => candidate !== locale) ?? 'fr';

  return (
    <Button
      variant="outline"
      className={cn(
        onDark &&
          'border-white/60 bg-white/10 text-white hover:bg-white hover:text-[#1b1840] focus-visible:border-white focus-visible:ring-white/60 aria-expanded:bg-white aria-expanded:text-[#1b1840] disabled:opacity-70',
        pill && 'h-8 gap-1.5 rounded-full px-3 text-[13px] font-semibold',
        pill && !onDark && 'bg-background/50 text-muted-foreground',
      )}
      aria-label={`${t('label')} : ${LOCALE_LABELS[other]}`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setLocale(other);
          router.refresh();
        })
      }
    >
      <LanguagesIcon data-icon="inline-start" />
      <span lang={other}>{LOCALE_LABELS[other]}</span>
    </Button>
  );
}
