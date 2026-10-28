import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginTabs } from '@/features/auth/login-tabs';
import { currentSpace, DEMO_SPACE_COOKIE, demoSpaces } from '@/lib/space/space.server';

/**
 * Connexion à l'espace de l'adresse : back-office du traiteur (sous-domaine ou domaine
 * personnalisé) ou console de la plateforme. En démonstration seulement, la console propose de
 * choisir le traiteur (« ?traiteur=<identifiant> » ou la liste).
 */
export default async function LoginPage({ searchParams }: PageProps<'/admin/login'>) {
  const t = await getTranslations('auth.login');
  const ts = await getTranslations('space');
  const { traiteur } = await searchParams;
  const demo = await demoSpaces();
  if (demo && typeof traiteur === 'string') {
    redirect(`/api/space/demo?traiteur=${encodeURIComponent(traiteur)}`);
  }
  const space = await currentSpace();
  const chosen = (await cookies()).get(DEMO_SPACE_COOKIE)?.value;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          <CardDescription className="text-base">
            {space?.kind === 'traiteur'
              ? t('subtitleTraiteur', { name: space.traiteur.name })
              : t('subtitlePlatform')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* useSearchParams (page de retour « ?next= ») exige une frontière Suspense */}
          <Suspense>
            <LoginTabs smsLogin={space?.kind === 'traiteur'} />
          </Suspense>
        </CardContent>
      </Card>

      {demo && (
        <Card className="border-dashed" data-testid="demo-space-picker">
          <CardHeader>
            <CardTitle className="text-base">{ts('demoTitle')}</CardTitle>
            <CardDescription>{ts('demoHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              <li>
                <Link
                  href="/api/space/demo?traiteur=platform"
                  prefetch={false}
                  className="underline-offset-4 hover:underline"
                  aria-current={chosen ? undefined : 'true'}
                >
                  {ts('demoPlatform')}
                  {!chosen && ` · ${ts('demoCurrent')}`}
                </Link>
              </li>
              {demo.traiteurs.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/api/space/demo?traiteur=${item.slug}`}
                    prefetch={false}
                    className="underline-offset-4 hover:underline"
                    aria-current={chosen === item.slug ? 'true' : undefined}
                    dir="auto"
                  >
                    {item.name}
                    {chosen === item.slug && ` · ${ts('demoCurrent')}`}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
