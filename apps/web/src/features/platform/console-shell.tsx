'use client';

import {
  BadgePercentIcon,
  LayersIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  StoreIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect } from 'react';

import { LanguageSwitcher } from '@/components/layout/language-switcher';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { UserMenu } from '@/features/navigation/user-menu';

interface PlatformNavItem {
  labelKey: 'dashboard' | 'traiteurs' | 'plans';
  href: string;
  icon: LucideIcon;
}

/** Menu de la console, dans l'ordre d'affichage (complété au fil des étapes). */
const PLATFORM_NAV: readonly PlatformNavItem[] = [
  { labelKey: 'dashboard', href: '/platform', icon: LayoutDashboardIcon },
  { labelKey: 'traiteurs', href: '/platform/traiteurs', icon: StoreIcon },
  { labelKey: 'plans', href: '/platform/plans', icon: BadgePercentIcon },
];

function isActive(item: PlatformNavItem, pathname: string): boolean {
  return item.href === '/platform'
    ? pathname === '/platform'
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Badge permanent : on sait toujours qu'on agit en tant que plateforme. */
export function SuperAdminBadge() {
  const t = useTranslations('platform');
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1 text-xs font-bold tracking-wide text-[#1b1840] uppercase"
      data-testid="super-admin-badge"
    >
      <span aria-hidden>●</span>
      {t('badge')}
    </span>
  );
}

function ConsoleSidebar() {
  const t = useTranslations('platform');
  const locale = useLocale();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const rtl = locale === 'ar';
  return (
    <Sidebar side={rtl ? 'right' : 'left'} dir={rtl ? 'rtl' : 'ltr'} collapsible="offcanvas">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <LayersIcon className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold text-white">{t('brand')}</span>
            <span className="text-xs opacity-75">{t('brandSub')}</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {PLATFORM_NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    size="lg"
                    isActive={isActive(item, pathname)}
                    className="text-base"
                  >
                    <Link
                      href={item.href}
                      onClick={() => {
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <item.icon aria-hidden />
                      <span>{t(`nav.${item.labelKey}`)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/15 px-3 py-2 text-xs text-amber-200">
          {t('privacyNote')}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * Ossature de la console : barre latérale bleu nuit, barre du haut indigo, badge « Super
 * admin » permanent. Thème posé sur <html> le temps de la visite (fenêtres et menu mobile
 * compris), retiré en quittant la console.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('platform-theme');
    return () => document.documentElement.classList.remove('platform-theme');
  }, []);

  return (
    <SidebarProvider>
      <ConsoleSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 bg-[var(--platform-topbar)] px-4 text-[var(--platform-topbar-foreground)]">
          <SidebarTrigger className="hover:bg-white/10 hover:text-white" />
          <div className="ms-auto flex items-center gap-2">
            <SuperAdminBadge />
            <LanguageSwitcher />
            <UserMenu accountHref="/platform/account" />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
