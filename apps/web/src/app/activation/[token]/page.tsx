import { type PublicActivation, publicActivationSchema } from '@traiteur/shared';
import { SearchXIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { clientIpFromHeaders } from '@/app/api/session/_lib/client-ip';
import { MessageScreen } from '@/components/layout/message-screen';
import { serverEnv } from '@/lib/env/server';

import { PlatformActivationForm } from './platform-activation-form';

/** Activation d'un compte de la plateforme : jamais indexée, jeton jamais transmis. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

async function loadActivation(token: string): Promise<PublicActivation | null> {
  const env = serverEnv();
  const forwarded: Record<string, string> = { Accept: 'application/json' };
  const ip = clientIpFromHeaders(await headers(), env.WEB_TRUSTED_PROXY_HOPS);
  if (ip) forwarded['X-Forwarded-For'] = ip;
  const response = await fetch(
    `${env.API_INTERNAL_URL}/public/activations/${encodeURIComponent(token)}`,
    { headers: forwarded, cache: 'no-store' },
  );
  if (!response.ok) return null;
  const parsed = publicActivationSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export default async function ActivationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const activation = await loadActivation(token);
  if (!activation) {
    const t = await getTranslations('platformActivation.invalid');
    return <MessageScreen icon={SearchXIcon} title={t('title')} description={t('description')} />;
  }
  return <PlatformActivationForm token={token} activation={activation} />;
}
