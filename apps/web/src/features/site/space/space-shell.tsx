'use client';

import { LogOutIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ApprovalNotice } from '../approval-notice';
import { useClientAccount } from '../client-api';
import { clientSessionStore } from '../client-session-store';

const SECTIONS = [
  { href: '/espace', key: 'home' },
  { href: '/espace/demandes', key: 'orders' },
  { href: '/espace/devis', key: 'quotes' },
  { href: '/espace/factures', key: 'invoices' },
  { href: '/espace/paiements', key: 'payments' },
  { href: '/espace/profil', key: 'profile' },
] as const;

/** Espace du client : bienvenue, accord du traiteur, menu des rubriques, déconnexion. */
export function SpaceShell({ children }: { children: ReactNode }) {
  const t = useTranslations('site.space');
  const account = useClientAccount();
  const router = useRouter();
  const pathname = usePathname();
  const active = (href: string) =>
    href === '/espace' ? pathname === '/espace' : pathname.startsWith(href);

  return (
    <div className="flex flex-col gap-5" data-testid="client-account">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {account.data ? (
          <h1 className="text-2xl font-semibold" dir="auto">
            {t('welcome', { name: account.data.firstName })}
          </h1>
        ) : (
          <Skeleton className="h-8 w-48" />
        )}
        <Button
          variant="outline"
          onClick={async () => {
            await clientSessionStore.logout();
            router.replace('/connexion');
          }}
        >
          <LogOutIcon data-icon="inline-start" />
          {t('logout')}
        </Button>
      </div>
      {account.data && <ApprovalNotice account={account.data} />}
      <nav aria-label={t('menu')} className="overflow-x-auto">
        <ul className="flex gap-1 border-b">
          {SECTIONS.map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active(section.href) ? 'page' : undefined}
                className={
                  active(section.href)
                    ? 'inline-block border-b-2 border-primary px-3 py-2 text-sm font-medium whitespace-nowrap'
                    : 'inline-block px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground'
                }
              >
                {t(`sections.${section.key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
