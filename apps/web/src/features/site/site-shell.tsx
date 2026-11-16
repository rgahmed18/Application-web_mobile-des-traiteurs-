'use client';

import { sitePalette } from '@traiteur/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';

import { useSpace } from '@/features/space/space-provider';
import { cn } from '@/lib/utils';

import { siteFontClasses } from './site-fonts';
import { usePublicSite } from './site-api';
import { SiteHeader } from './site-header';
import { WhatsAppButton } from './whatsapp-button';

/** Couleurs de la palette du traiteur, en variables CSS pour tout le site (boutons, accents). */
function paletteStyle(code: string | undefined): CSSProperties {
  const palette = sitePalette(code);
  return {
    '--primary': palette.primary,
    '--primary-foreground': '#ffffff',
    '--ring': palette.primary,
    '--background': palette.background,
    '--site-accent': palette.accent,
    '--site-accent-text': palette.accentText,
    '--site-sand': palette.sand,
  } as CSSProperties;
}

/** Pages pleine largeur (bandeau d'un bord à l'autre) : accueil et catalogue. */
const FULL_WIDTH = new Set(['/', '/catalogue']);

/**
 * Cadre du site client, pensé pour le téléphone d'abord : en-tête collant (marque, menu, langue,
 * espace client, « Demander un devis » toujours visible), palette et polices du site, pied de
 * page. Bouton WhatsApp flottant en bas de l'écran (s'il est réglé).
 */
export function SiteShell({ children }: { children: ReactNode }) {
  const t = useTranslations('site');
  const pathname = usePathname();
  const space = useSpace();
  const site = usePublicSite();
  const fullWidth = FULL_WIDTH.has(pathname);
  const whatsappPhone = site.data?.whatsappPhone ?? null;
  const name = space?.kind === 'traiteur' ? space.traiteur.name : '';

  return (
    <div
      className={cn('site flex min-h-svh flex-col bg-background', siteFontClasses)}
      style={paletteStyle(site.data?.palette)}
    >
      <SiteHeader whatsappPhone={whatsappPhone} />
      <main className={cn('w-full flex-1', !fullWidth && 'mx-auto max-w-6xl px-4 py-6')}>
        {children}
      </main>
      <footer className={cn('border-t', whatsappPhone && 'pb-20 md:pb-0')}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
          <span>
            <span dir="auto">© {name}</span>
            {' · '}
            <Link href="/confidentialite" className="underline underline-offset-4">
              {t('footer.privacy')}
            </Link>
          </span>
          <span className="text-xs opacity-80" data-testid="powered-by">
            {t('footer.poweredBy')}
          </span>
        </div>
      </footer>
      {whatsappPhone && <WhatsAppButton phone={whatsappPhone} />}
    </div>
  );
}
