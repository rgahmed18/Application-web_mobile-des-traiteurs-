'use client';

import { LogOutIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

import { useClientSession } from './client-session-provider';
import { clientSessionStore } from './client-session-store';

/** Espace du client : accueil (demandes, devis, factures et profil aux étapes suivantes). */
export function ClientAccountHome() {
  const t = useTranslations('site.account');
  const session = useClientSession();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6" data-testid="client-account">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold" dir="auto">
          {t('welcome', { name: session.user?.firstName ?? '' })}
        </h1>
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
    </div>
  );
}
