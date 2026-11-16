'use client';

import { sitePalette } from '@traiteur/shared';
import { ArrowRightIcon, LogInIcon, UserRoundIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';

import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { Button } from '@/components/ui/button';
import { SpaceBrand } from '@/features/space/space-brand';
import { useSpace } from '@/features/space/space-provider';
import { cn } from '@/lib/utils';

import { useCart } from './cart-store';
import { useClientSession } from './client-session-provider';
import { siteFontClasses } from './site-fonts';
import { usePublicSite } from './site-api';
import { WhatsAppButton } from './whatsapp-button';

/** Liens du menu du site. */
export interface SiteNavLink {
  href: string;
  label: string;
  testId: string;
}

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

/** Pages où « Demander un devis » ne reste pas en bas de l'écran (elles ont leurs boutons). */
const NO_STICKY_QUOTE = ['/demande', '/connexion', '/espace'];

/**
 * Cadre du site client, pensé pour le téléphone d'abord : marque du traiteur, menu, langue,
 * accès à l'espace client ; palette et polices du site ; sur l'accueil, en-tête posé sur le
 * bandeau. Bouton WhatsApp flottant (s'il est réglé) et « Demander un devis » toujours visible
 * sur téléphone.
 */
export function SiteShell({ children }: { children: ReactNode }) {
  const t = useTranslations('site');
  const session = useClientSession();
  const cart = useCart();
  const pathname = usePathname();
  const space = useSpace();
  const site = usePublicSite();
  const home = pathname === '/';
  const stickyQuote = !NO_STICKY_QUOTE.some((path) => pathname.startsWith(path));
  const name = space?.kind === 'traiteur' ? space.traiteur.name : '';
  const links: SiteNavLink[] = [
    { href: '/', label: t('nav.home'), testId: 'site-nav-home' },
    { href: '/catalogue', label: t('nav.catalog'), testId: 'site-nav-catalog' },
    {
      href: '/demande',
      label: cart.length > 0 ? t('nav.requestCount', { count: cart.length }) : t('nav.request'),
      testId: 'site-nav-request',
    },
  ];
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div
      className={cn('site flex min-h-svh flex-col bg-background', siteFontClasses)}
      style={paletteStyle(site.data?.palette)}
    >
      <header
        className={cn(
          'z-30',
          home
            ? 'absolute inset-x-0 top-0 text-white'
            : 'sticky top-0 border-b bg-background/95 backdrop-blur',
        )}
        data-testid="site-header"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <Link
            href="/"
            className={cn('min-w-0 flex-1', home && '[text-shadow:0_1px_8px_rgb(0_0_0/0.45)]')}
            aria-label={t('nav.home')}
          >
            <SpaceBrand />
          </Link>
          <nav
            aria-label={t('nav.label')}
            className="order-last -mx-1 w-full overflow-x-auto md:order-none md:mx-0 md:w-auto"
          >
            <ul className="flex gap-1">
              {links.map((link) => (
                <li key={link.href}>
                  <Button
                    asChild
                    variant={active(link.href) && !home ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn(home && 'text-white hover:bg-white/15 hover:text-white')}
                  >
                    <Link
                      href={link.href}
                      data-testid={link.testId}
                      aria-current={active(link.href) ? 'page' : undefined}
                    >
                      {link.label}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
          <LanguageSwitcher onDark={home} />
          {session.status === 'authenticated' ? (
            <Button asChild>
              <Link href="/espace" data-testid="site-account-link">
                <UserRoundIcon data-icon="inline-start" />
                <span className="hidden sm:inline">{t('nav.account')}</span>
              </Link>
            </Button>
          ) : (
            <Button asChild variant={session.status === 'loading' ? 'outline' : 'default'}>
              <Link href="/connexion" data-testid="site-login-link">
                <LogInIcon data-icon="inline-start" />
                <span className="hidden sm:inline">{t('nav.login')}</span>
              </Link>
            </Button>
          )}
        </div>
      </header>
      <main
        className={cn(
          'w-full flex-1',
          !home && 'mx-auto max-w-6xl px-4 py-6',
          stickyQuote && 'pb-24 md:pb-6',
        )}
      >
        {children}
      </main>
      <footer className={cn('border-t', stickyQuote && 'pb-20 md:pb-0')}>
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
      {site.data?.whatsappPhone && (
        <WhatsAppButton phone={site.data.whatsappPhone} raised={stickyQuote} />
      )}
      {stickyQuote && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          <Button asChild size="lg" className="h-12 w-full rounded-full text-base">
            <Link href="/demande" data-testid="sticky-quote">
              {t('home.requestQuote')}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
