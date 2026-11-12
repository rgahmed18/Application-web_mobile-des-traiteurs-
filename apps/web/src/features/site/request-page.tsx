'use client';

import { LogInIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

import { CartReview } from './cart-review';
import { useClientSession } from './client-session-provider';
import { siteLoginHref } from './site-redirect';

/** « Ma demande » : sélection du catalogue, puis connexion pour l'envoyer au traiteur. */
export function RequestPage() {
  const t = useTranslations('site.cart');
  const session = useClientSession();
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </header>
      <CartReview
        footer={
          session.status === 'anonymous' && (
            <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-4">
              <p>{t('loginToSend')}</p>
              <Button asChild size="lg" className="self-start">
                <Link href={siteLoginHref('/demande')}>
                  <LogInIcon data-icon="inline-start" />
                  {t('login')}
                </Link>
              </Button>
            </div>
          )
        }
      />
    </div>
  );
}
