import { Brand } from '@/components/layout/brand';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { RedirectIfAuthenticated } from '@/features/auth/auth-gates';

/** Écrans sans session : carte centrée, lisible sur téléphone comme sur tablette. */
export default function AuthLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex items-center justify-between gap-4 p-4">
        <Brand />
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-10 sm:items-center">
        <div className="w-full max-w-md">
          <RedirectIfAuthenticated>{children}</RedirectIfAuthenticated>
        </div>
      </main>
    </div>
  );
}
