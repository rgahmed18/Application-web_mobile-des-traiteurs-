'use client';

import { ClockIcon, LogOutIcon, ShieldAlertIcon, TimerResetIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { PLATFORM_HOME_PATH } from '@/features/auth/redirect';
import { useSession } from '@/features/auth/session-provider';
import { refreshAccessToken, sessionStore } from '@/features/auth/session-store';
import { ReasonDialog } from '@/features/orders/order-dialogs';
import { useErrorMessage } from '@/lib/api/use-error-message';

/** Hauteur du bandeau : la barre du haut et le menu latéral sont décalés d'autant. */
export const PLATFORM_BANNER_CLASS = 'h-12';

/** Temps restant, mis à jour toutes les 15 secondes. */
function useRemaining(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return expiresAt ? Date.parse(expiresAt) - now : null;
}

/**
 * Bandeau du super admin entré chez un traiteur : impossible à manquer (rayé, fixé en haut),
 * nom du traiteur, motif, temps restant, « Prolonger » (nouveau motif) et « Quitter ». À la fin
 * de l'accès, la session revient d'elle-même à la console.
 */
export function PlatformAccessBanner() {
  const t = useTranslations('platform.access');
  const describeError = useErrorMessage();
  const { platformAccess } = useSession();
  const remaining = useRemaining(platformAccess?.expiresAt);
  const [extending, setExtending] = useState(false);
  const [pending, setPending] = useState(false);
  const ended = useRef(false);

  const expired = remaining !== null && remaining <= 0;
  useEffect(() => {
    if (!expired || ended.current) return;
    ended.current = true;
    toast.warning(t('ended'));
    // Le rafraîchissement renvoie une session de la console : la page y est redirigée
    void refreshAccessToken();
  }, [expired, t]);

  if (!platformAccess || remaining === null) return null;

  const minutesLeft = Math.max(0, Math.ceil(remaining / 60_000));
  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;
  const timeLeft =
    hours > 0
      ? t('expiresInHours', { hours, minutes: String(minutes).padStart(2, '0') })
      : t('expiresInMinutes', { minutes });

  async function leave() {
    setPending(true);
    try {
      await sessionStore.leaveTraiteur();
      window.location.assign(PLATFORM_HOME_PATH);
    } catch (error) {
      setPending(false);
      toast.error(describeError(error));
    }
  }

  return (
    <>
      <div
        role="alert"
        data-testid="platform-access-banner"
        className={`fixed inset-x-0 top-0 z-50 flex ${PLATFORM_BANNER_CLASS} items-center gap-2 border-b-2 border-amber-600 bg-[repeating-linear-gradient(135deg,#fbbf24_0,#fbbf24_14px,#f59e0b_14px,#f59e0b_28px)] px-3 text-[#1b1840] sm:gap-3 sm:px-4`}
      >
        <ShieldAlertIcon className="size-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto">
          <span className="hidden sm:inline">
            {t('insideLong', { name: platformAccess.traiteurName })}
          </span>
          <span className="sm:hidden">
            {t('insideShort', { name: platformAccess.traiteurName })}
          </span>
          <span className="hidden font-normal lg:inline">
            {' '}
            · {t('reason', { reason: platformAccess.reason })}
          </span>
        </p>
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
            minutesLeft <= 10 ? 'bg-rose-700 text-white' : 'bg-[#1b1840]/90 text-amber-200'
          }`}
          data-testid="platform-access-remaining"
        >
          <ClockIcon className="size-3.5" aria-hidden />
          {timeLeft}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 border-[#1b1840]/40 bg-white/80 text-[#1b1840] hover:bg-white"
          disabled={pending}
          onClick={() => setExtending(true)}
          aria-label={t('extend')}
        >
          <TimerResetIcon aria-hidden />
          <span className="hidden md:inline">{t('extend')}</span>
        </Button>
        <Button
          type="button"
          size="sm"
          className="shrink-0 bg-[#1b1840] text-white hover:bg-[#2a2560]"
          disabled={pending}
          onClick={() => void leave()}
          aria-label={t('leave')}
        >
          <LogOutIcon aria-hidden className="rtl:rotate-180" />
          <span className="hidden md:inline">{t('leave')}</span>
        </Button>
      </div>
      <ReasonDialog
        open={extending}
        title={t('extendTitle')}
        description={t('extendDescription')}
        label={t('reasonLabel')}
        placeholder={t('reasonPlaceholder')}
        confirmLabel={t('extend')}
        pending={pending}
        onCancel={() => setExtending(false)}
        onConfirm={(reason) => {
          setExtending(false);
          setPending(true);
          sessionStore
            .extendPlatformAccess(reason)
            .then(() => toast.success(t('extended')))
            .catch((error: unknown) => toast.error(describeError(error)))
            .finally(() => setPending(false));
        }}
      />
    </>
  );
}
