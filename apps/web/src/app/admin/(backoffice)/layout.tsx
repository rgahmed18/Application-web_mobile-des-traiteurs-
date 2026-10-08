import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { RequireSession } from '@/features/auth/auth-gates';
import { AppSidebar } from '@/features/navigation/app-sidebar';
import { UserMenu } from '@/features/navigation/user-menu';

/** Ossature du back-office : menu latéral, barre du haut, contenu. Exige une session. */
export default function BackofficeLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <RequireSession>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="ms-auto flex items-center gap-2">
              <LanguageSwitcher />
              <UserMenu />
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </RequireSession>
  );
}
