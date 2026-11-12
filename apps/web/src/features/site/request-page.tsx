'use client';

import { LogInIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ApprovalNotice } from './approval-notice';
import { CartReview } from './cart-review';
import { useClientAccount } from './client-api';
import { useClientSession } from './client-session-provider';
import { RequestWizard } from './request-wizard';
import { siteLoginHref } from './site-redirect';

/**
 * « Ma demande » : sélection du catalogue ; une fois connecté (et accepté par le traiteur si son
 * réglage l'exige), la demande se complète et s'envoie en 4 étapes.
 */
export function RequestPage() {
  const t = useTranslations('site.cart');
  const session = useClientSession();
  const account = useClientAccount();

  let content;
  if (session.status === 'loading' || (session.status === 'authenticated' && !account.data)) {
    content = <Skeleton className="h-64 w-full" />;
  } else if (session.status === 'anonymous') {
    content = (
      <CartReview
        footer={
          <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-4">
            <p>{t('loginToSend')}</p>
            <Button asChild size="lg" className="self-start">
              <Link href={siteLoginHref('/demande')}>
                <LogInIcon data-icon="inline-start" />
                {t('login')}
              </Link>
            </Button>
          </div>
        }
      />
    );
  } else if (account.data && account.data.approval !== 'APPROVED') {
    content = (
      <div className="flex flex-col gap-4">
        <ApprovalNotice account={account.data} />
        <CartReview />
      </div>
    );
  } else {
    content = <RequestWizard />;
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </header>
      {content}
    </div>
  );
}
