'use client';

import { ArrowRightIcon, LogInIcon, MenuIcon, UserRoundIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useState } from 'react';

import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { Button } from '@/components/ui/button';
import { initialsOf } from '@/features/navigation/traiteur-brand';
import { useSpace } from '@/features/space/space-provider';
import { cn } from '@/lib/utils';

import { useCart } from './cart-store';
import { useClientSession } from './client-session-provider';
import { WhatsAppIcon } from './whatsapp-button';

/** Défilement au-delà de quelques pixels : l'en-tête prend son fond flouté. */
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return scrolled;
}

/** Marque du traiteur : logo (ou initiales dans un cercle) et nom, en police des titres. */
function SiteBrand({ onDark }: { onDark: boolean }) {
  const space = useSpace();
  if (space?.kind !== 'traiteur') return null;
  const { name, logoUrl } = space.traiteur;
  return (
    <span className="flex min-w-0 items-center gap-2.5" data-testid="space-brand">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="size-10 shrink-0 rounded-full bg-white object-contain p-0.5 md:size-12"
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full border-[1.5px] text-sm font-bold md:size-12 md:text-base',
            onDark ? 'border-white/85 text-white' : 'border-[var(--site-accent)] text-primary',
          )}
        >
          {initialsOf(name)}
        </span>
      )}
      {/* Police des titres à partir de 24 px seulement (grand écran) */}
      <span
        className="truncate text-base font-extrabold md:font-display md:text-[26px] md:font-bold"
        dir="auto"
        title={name}
      >
        {name}
      </span>
    </span>
  );
}

interface NavLink {
  href: string;
  label: string;
  testId: string;
  count?: number;
}

/** Pastille du nombre d'éléments de « Ma demande ». */
function CountBadge({ count, testId }: { count: number; testId: string }) {
  return (
    <span
      className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-extrabold text-primary-foreground"
      data-testid={testId}
    >
      {count}
    </span>
  );
}

/**
 * Menu plein écran du téléphone : grands liens (page active soulignée), « Demander un devis »,
 * connexion, WhatsApp et langue. Fenêtre accessible (focus gardé dedans, Échap pour fermer).
 */
function MobileMenu({
  links,
  active,
  whatsappPhone,
}: {
  links: NavLink[];
  active: (href: string) => boolean;
  whatsappPhone: string | null;
}) {
  const t = useTranslations('site');
  const session = useClientSession();
  const [open, setOpen] = useState(false);
  const signedIn = session.status === 'authenticated';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-current/20 bg-background/60 md:hidden"
          aria-label={t('nav.openMenu')}
          data-testid="site-menu-button"
        >
          <MenuIcon className="size-[22px]" aria-hidden />
        </button>
      </DialogPrimitive.Trigger>
      {/* Dans le cadre du site : polices et palette du traiteur */}
      <DialogPrimitive.Portal
        container={open ? document.querySelector<HTMLElement>('.site') : undefined}
      >
        <DialogPrimitive.Content
          className="site-menu fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background text-foreground"
          data-testid="site-menu"
          aria-describedby={undefined}
          // Fermé dès qu'un lien est suivi (changement de page)
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) setOpen(false);
          }}
        >
          <div className="flex h-16 items-center justify-between gap-3 border-b px-4">
            <DialogPrimitive.Title asChild>
              <span className="min-w-0">
                <SiteBrand onDark={false} />
              </span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border"
              aria-label={t('nav.closeMenu')}
            >
              <XIcon className="size-[22px]" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label={t('nav.label')} className="px-6 py-4">
            <ul>
              {links.map((link) => (
                <li key={link.href} className="site-menu-item border-b">
                  <Link
                    href={link.href}
                    aria-current={active(link.href) ? 'page' : undefined}
                    className="group flex items-center justify-between gap-3 py-3 font-display text-4xl leading-tight font-bold"
                  >
                    <span className="inline-flex items-center gap-3">
                      <span className="group-aria-[current=page]:shadow-[inset_0_-3px_0_var(--primary)]">
                        {link.label}
                      </span>
                      {link.count ? (
                        <span className="font-sans">
                          <CountBadge count={link.count} testId="site-menu-request-count" />
                        </span>
                      ) : null}
                    </span>
                    <ArrowRightIcon className="size-5 shrink-0 rtl:rotate-180" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-auto grid gap-3 px-6 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <Button asChild size="lg" className="h-14 rounded-full text-base">
              <Link href="/demande">
                {t('home.requestQuote')}
                <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-14 rounded-full text-base">
              <Link href={signedIn ? '/espace' : '/connexion'}>
                {signedIn ? (
                  <UserRoundIcon data-icon="inline-start" />
                ) : (
                  <LogInIcon data-icon="inline-start" />
                )}
                {t(signedIn ? 'nav.account' : 'nav.login')}
              </Link>
            </Button>
            <div className="flex items-center justify-between gap-3 pt-1 text-sm text-muted-foreground">
              {whatsappPhone ? (
                <span className="inline-flex items-center gap-1.5" dir="ltr">
                  <WhatsAppIcon className="size-5 text-[#25d366]" />
                  {whatsappPhone}
                </span>
              ) : (
                <span />
              )}
              <LanguageSwitcher pill />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * En-tête du site client : haut et aéré, collant en haut de l'écran, fond ivoire flouté dès que
 * la page défile (sur l'accueil, posé transparent sur le bandeau jusque-là). Liens soulignés d'un
 * fin trait dans la couleur principale ; « Demander un devis » toujours visible (« Devis » sur
 * téléphone) ; langue en petite pastille ; menu plein écran sur téléphone.
 */
export function SiteHeader({ whatsappPhone }: { whatsappPhone: string | null }) {
  const t = useTranslations('site');
  const session = useClientSession();
  const cart = useCart();
  const pathname = usePathname();
  const scrolled = useScrolled();
  const home = pathname === '/';
  // Sur l'accueil, texte clair sur la photo tant que la page n'a pas défilé
  const overPhoto = home && !scrolled;
  const links: NavLink[] = [
    { href: '/', label: t('nav.home'), testId: 'site-nav-home' },
    { href: '/catalogue', label: t('nav.catalog'), testId: 'site-nav-catalog' },
    {
      href: '/demande',
      label: t('nav.request'),
      testId: 'site-nav-request',
      count: cart.length,
    },
  ];
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const signedIn = session.status === 'authenticated';

  return (
    <header
      className={cn(
        'site-header inset-x-0 top-0 z-30 transition-[background-color,box-shadow,color] duration-300',
        home ? 'fixed' : 'sticky',
        overPhoto ? 'text-white' : 'text-foreground',
        scrolled ? 'site-header-scrolled' : !home && 'bg-background',
      )}
      data-scrolled={scrolled ? '' : undefined}
      // État de la session (parcours de test : reprise de session attendue, même sur téléphone)
      data-session={session.status}
      data-testid="site-header"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 md:h-[84px] md:gap-6">
        <Link
          href="/"
          className={cn(
            'min-w-0 flex-1 md:flex-none',
            overPhoto && '[text-shadow:0_1px_8px_rgb(0_0_0/0.45)]',
          )}
          aria-label={t('nav.home')}
        >
          <SiteBrand onDark={overPhoto} />
        </Link>
        <nav aria-label={t('nav.label')} className="hidden md:mx-auto md:block">
          <ul className="flex items-center gap-9">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  data-testid={link.testId}
                  aria-current={active(link.href) ? 'page' : undefined}
                  className={cn(
                    'site-nav-link inline-flex items-center gap-2 py-2 text-[17px] font-semibold transition-colors',
                    overPhoto
                      ? 'text-white/85 hover:text-white aria-[current=page]:text-white'
                      : 'text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground',
                  )}
                >
                  {link.label}
                  {link.count ? (
                    <CountBadge count={link.count} testId="site-nav-request-count" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <LanguageSwitcher pill onDark={overPhoto} />
          <Button
            asChild
            variant="outline"
            size="icon"
            className={cn(
              'size-11 rounded-full',
              overPhoto &&
                'border-white/50 bg-black/15 text-white hover:bg-white/20 hover:text-white',
            )}
          >
            <Link
              href={signedIn ? '/espace' : '/connexion'}
              aria-label={t(signedIn ? 'nav.account' : 'nav.login')}
              data-testid={signedIn ? 'site-account-link' : 'site-login-link'}
            >
              {signedIn ? <UserRoundIcon /> : <LogInIcon />}
            </Link>
          </Button>
        </div>
        <Button
          asChild
          className="h-10 shrink-0 rounded-full px-4 text-[15px] font-bold shadow-[0_10px_26px_-12px_var(--primary)] md:h-12 md:px-6 md:text-base"
        >
          <Link href="/demande" data-testid="site-quote">
            <span className="md:hidden">{t('nav.quoteShort')}</span>
            <span className="hidden md:inline">{t('home.requestQuote')}</span>
            {cart.length > 0 && (
              <span
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground px-1 text-xs font-extrabold text-primary md:hidden"
                data-testid="site-quote-count"
              >
                {cart.length}
              </span>
            )}
          </Link>
        </Button>
        <MobileMenu links={links} active={active} whatsappPhone={whatsappPhone} />
      </div>
    </header>
  );
}
