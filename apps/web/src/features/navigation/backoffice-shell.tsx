'use client';

import type { ReactNode } from 'react';

import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { useSession } from '@/features/auth/session-provider';
import { PlatformAccessBanner } from '@/features/platform/platform-access-banner';

import { AppSidebar } from './app-sidebar';
import { UserMenu } from './user-menu';

/**
 * Ossature du back-office : menu latéral, barre du haut, contenu. Super admin entré chez le
 * traiteur : bandeau fixé en haut, la barre du haut et le menu latéral sont décalés dessous.
 */
export function BackofficeShell({ children }: { children: ReactNode }) {
  const { platformAccess } = useSession();
  const banner = platformAccess !== null;
  return (
    <>
      <PlatformAccessBanner />
      <SidebarProvider className={banner ? 'pt-12' : undefined}>
        <AppSidebar className={banner ? 'md:top-12 md:h-[calc(100svh-3rem)]' : undefined} />
        <SidebarInset>
          <header
            className={`sticky z-10 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur ${banner ? 'top-12' : 'top-0'}`}
          >
            <SidebarTrigger />
            <div className="ms-auto flex items-center gap-2">
              <LanguageSwitcher />
              <UserMenu />
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}
