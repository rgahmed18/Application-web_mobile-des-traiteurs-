import { useTranslations } from 'next-intl';
import { Suspense } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginTabs } from '@/features/auth/login-tabs';

export default function LoginPage() {
  const t = useTranslations('auth.login');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('title')}</CardTitle>
        <CardDescription className="text-base">{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* useSearchParams (page de retour « ?next= ») exige une frontière Suspense */}
        <Suspense>
          <LoginTabs />
        </Suspense>
      </CardContent>
    </Card>
  );
}
