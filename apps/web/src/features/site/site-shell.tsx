'use client';

import { LogInIcon, UserRoundIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { Button } from '@/components/ui/button';
import { SpaceBrand } from '@/features/space/space-brand';

import { useCart } from './cart-store';
import { useClientSession } from './client-session-provider';

/** Liens du menu du site. */
export interface SiteNavLink {
  href: string;
  label: string;
  testId: string;
}

/**
 * Cadre du site client : marque du traiteur, menu, langue, accès à l'espace client ; pensé pour
 * le téléphone d'abord (menu sur une ligne qui défile, boutons larges).
 */
export function SiteShell({ children }: { children: ReactNode }) {
  const t = useTranslations('site');
  const session = useClientSession();
  const cart = useCart();
  const pathname = usePathname();
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
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" className="min-w-0 flex-1" aria-label={t('nav.home')}>
            <SpaceBrand />
          </Link>
          <LanguageSwitcher />
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
        <nav aria-label={t('nav.label')} className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2">
          <ul className="flex gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Button asChild variant={active(link.href) ? 'secondary' : 'ghost'} size="sm">
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
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t bg-muted/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm text-muted-foreground">
          <span>{t('footer.rights')}</span>
          <Link href="/confidentialite" className="underline underline-offset-4">
            {t('footer.privacy')}
          </Link>
        </div>
      </footer>
    </div>
  );
}
