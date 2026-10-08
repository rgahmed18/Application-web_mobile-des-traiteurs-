'use client';

import { KeyRoundIcon, MessageSquareIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { PasswordLoginForm } from './password-login-form';
import { safeNextPath } from './redirect';
import { SmsLoginForm } from './sms-login-form';

/** Deux façons de se connecter, au choix : mot de passe ou code par SMS. */
export function LoginTabs() {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const onSuccess = () => router.replace(next);

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
        <PasswordLoginForm onSuccess={onSuccess} />
      </TabsContent>
      <TabsContent value="sms">
        <SmsLoginForm onSuccess={onSuccess} />
      </TabsContent>
    </Tabs>
  );
}
