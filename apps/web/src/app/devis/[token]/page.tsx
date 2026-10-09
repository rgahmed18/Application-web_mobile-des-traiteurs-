import { getTextDirection, type PublicQuote, publicQuoteSchema } from '@traiteur/shared';
import { SearchXIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';

import { clientIpFromHeaders } from '@/app/api/session/_lib/client-ip';
import { MessageScreen } from '@/components/layout/message-screen';
import type { UiLocale } from '@/i18n/config';
import { serverEnv } from '@/lib/env/server';

import { PublicQuoteView } from './public-quote-view';

/**
 * Devis consulté par le client via son lien sécurisé (sans connexion). Jamais indexé, aucun
 * « Referer » transmis (en-têtes posés aussi dans next.config.ts pour /devis/*).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

type Params = { token: string };
type Search = { lang?: string | string[] };

async function loadQuote(token: string, lang: UiLocale | null): Promise<PublicQuote | null> {
  const env = serverEnv();
  const requestHeaders = await headers();
  const forwarded: Record<string, string> = { Accept: 'application/json' };
  // IP du navigateur pour la limitation de débit de l'API (seulement via nos proxys)
  const ip = clientIpFromHeaders(requestHeaders, env.WEB_TRUSTED_PROXY_HOPS);
  if (ip) forwarded['X-Forwarded-For'] = ip;
  const url = new URL(`${env.API_INTERNAL_URL}/public/quotes/${encodeURIComponent(token)}`);
  if (lang) url.searchParams.set('lang', lang);
  const response = await fetch(url, { headers: forwarded, cache: 'no-store' });
  if (!response.ok) return null;
  const parsed = publicQuoteSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export default async function PublicQuotePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { token } = await params;
  const { lang } = await searchParams;
  const requested = lang === 'ar' || lang === 'fr' ? lang : null;
  const quote = await loadQuote(token, requested);

  if (!quote) {
    const t = await getTranslations('publicQuote');
    return (
      <MessageScreen
        icon={SearchXIcon}
        title={t('notFoundTitle')}
        description={t('notFoundDescription')}
      />
    );
  }

  // Langue du devis (choisie par le traiteur), ou celle demandée par le client
  const locale: UiLocale = requested ?? quote.locale;
  const messages = await getMessages({ locale });
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div lang={locale} dir={getTextDirection(locale)} className="flex flex-1 flex-col">
        <PublicQuoteView token={token} initial={quote} locale={locale} />
      </div>
    </NextIntlClientProvider>
  );
}
