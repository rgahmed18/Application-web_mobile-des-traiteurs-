'use client';

import type { TwoFactorChallenge } from '@traiteur/shared';
import { KeyRoundIcon, MessageSquareIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { PasswordLoginForm } from './password-login-form';
import { destinationFor, safeNextPath } from './redirect';
import { isPlatformSession, sessionStore } from './session-store';
import { SmsLoginForm } from './sms-login-form';
import { TwoFactorStep } from './two-factor-step';

/**
 * Deux façons de se connecter, au choix : mot de passe ou code par SMS ; puis, si la double
 * authentification est active (ou imposée), la deuxième étape.
 */
export function LoginTabs() {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const onSuccess = () =>
    router.replace(destinationFor(next, isPlatformSession(sessionStore.getSnapshot())));
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const onResult = (result: TwoFactorChallenge | null) =>
    result ? setChallenge(result) : onSuccess();

  if (challenge) {
    return (
      <TwoFactorStep
        key={challenge.challengeToken}
        challenge={challenge}
        onDone={onSuccess}
        onRestart={() => setChallenge(null)}
      />
    );
  }

  return (
    <Tabs defaultValue="password" className="gap-6">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="password">
          <KeyRoundIcon aria-hidden />
          {t('tabPassword')}
        </TabsTrigger>
        <TabsTrigger value="sms">
          <MessageSquareIcon aria-hidden />
          {t('tabSms')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="password">
        <PasswordLoginForm onResult={onResult} />
      </TabsContent>
      <TabsContent value="sms">
        <SmsLoginForm onResult={onResult} />
      </TabsContent>
    </Tabs>
  );
}
