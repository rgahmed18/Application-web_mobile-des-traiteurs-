'use client';

import type { PermissionKey } from '@traiteur/shared';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { Skeleton } from '@/components/ui/skeleton';

import { HOME_PATH, LOGIN_PATH, PLATFORM_HOME_PATH } from './redirect';
import { usePermission, useSession } from './session-provider';
import { ForbiddenScreen } from './forbidden-screen';
import { isPlatformSession } from './session-store';

/** Squelette affiché pendant la restauration de la session (fraction de seconde). */
function SessionLoading() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** Pages de connexion : un utilisateur déjà connecté est renvoyé vers le back-office. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    router.replace(isPlatformSession(session) ? PLATFORM_HOME_PATH : HOME_PATH);
  }, [session, router]);

  if (session.status === 'loading') return <SessionLoading />;
  if (session.status === 'authenticated') return null;
  return children;
}

/**
 * Back-office (ou console) : exige une session. Sans session, renvoi vers la connexion en
 * mémorisant la page ; si la session vient d'expirer, l'utilisateur en est informé. Chaque
 * espace refuse l'autre : le super admin en session plateforme est renvoyé vers la console, tout
 * autre compte vers le back-office.
 */
export function RequireSession({
  area = 'backoffice',
  children,
}: {
  area?: 'backoffice' | 'platform';
  children: ReactNode;
}) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('auth');
  const notified = useRef(false);

  useEffect(() => {
    if (session.status !== 'anonymous') return;
    if (session.endReason === 'expired' && !notified.current) {
      notified.current = true;
      toast.warning(t('sessionExpired'));
    }
    const next = session.endReason === 'logout' ? '' : `?next=${encodeURIComponent(pathname)}`;
    router.replace(`${LOGIN_PATH}${next}`);
  }, [session.status, session.endReason, pathname, router, t]);

  const wrongArea =
    session.status === 'authenticated' && isPlatformSession(session) !== (area === 'platform');
  useEffect(() => {
    if (wrongArea) router.replace(area === 'platform' ? HOME_PATH : PLATFORM_HOME_PATH);
  }, [wrongArea, area, router]);

  if (session.status !== 'authenticated' || wrongArea) return <SessionLoading />;
  return children;
}

/** Page réservée à une permission : sinon, écran « Accès refusé ». */
export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactNode;
}) {
  const can = usePermission();
  return can(permission) ? children : <ForbiddenScreen />;
}
