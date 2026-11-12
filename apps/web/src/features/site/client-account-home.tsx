'use client';

import { LogOutIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ApprovalNotice } from './approval-notice';
import { useClientAccount } from './client-api';
import { clientSessionStore } from './client-session-store';

/** Espace du client : accueil (demandes, devis, factures et profil aux étapes suivantes). */
export function ClientAccountHome() {
  const t = useTranslations('site.account');
  const account = useClientAccount();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6" data-testid="client-account">
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
    </div>
  );
}
