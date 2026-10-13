import { getTextDirection, type PublicInvitation, publicInvitationSchema } from '@traiteur/shared';
import { SearchXIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';

import { clientIpFromHeaders } from '@/app/api/session/_lib/client-ip';
import { MessageScreen } from '@/components/layout/message-screen';
import { serverEnv } from '@/lib/env/server';

import { ActivationForm } from './activation-form';

/** Activation d'un accès du personnel par son lien : jamais indexée, jeton jamais transmis. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

type Result = { invitation: PublicInvitation } | { error: 'expired' | 'invalid' };

async function loadInvitation(token: string): Promise<Result> {
  const env = serverEnv();
  const forwarded: Record<string, string> = { Accept: 'application/json' };
  const ip = clientIpFromHeaders(await headers(), env.WEB_TRUSTED_PROXY_HOPS);
  if (ip) forwarded['X-Forwarded-For'] = ip;
  const response = await fetch(
    `${env.API_INTERNAL_URL}/public/invitations/${encodeURIComponent(token)}`,
    { headers: forwarded, cache: 'no-store' },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const expired =
      body !== null &&
      typeof body === 'object' &&
      'code' in body &&
      body.code === 'INVITATION_EXPIRED';
    return { error: expired ? 'expired' : 'invalid' };
  }
  const parsed = publicInvitationSchema.safeParse(await response.json());
  return parsed.success ? { invitation: parsed.data } : { error: 'invalid' };
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await loadInvitation(token);
  if ('error' in result) {
    const t = await getTranslations('invitation');
    return (
      <MessageScreen
        icon={SearchXIcon}
        title={t(`${result.error}.title`)}
        description={t(`${result.error}.description`)}
      />
    );
  }
  const locale = result.invitation.locale;
  const messages = await getMessages({ locale });
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div lang={locale} dir={getTextDirection(locale)} className="flex flex-1 flex-col">
        <ActivationForm token={token} invitation={result.invitation} />
      </div>
    </NextIntlClientProvider>
  );
}
