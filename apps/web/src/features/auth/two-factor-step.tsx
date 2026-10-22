'use client';

import { useQuery } from '@tanstack/react-query';
import type { TwoFactorChallenge } from '@traiteur/shared';
import { ShieldCheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

import { OtpCodeInput } from '@/components/forms/otp-code-input';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';

import { RecoveryCodesPanel } from './recovery-codes-panel';
import { sessionStore } from './session-store';
import { TwoFactorSetupView } from './two-factor-setup-view';

/**
 * Deuxième étape de la connexion : code de l'application (ou code de secours), ou activation
 * imposée (SUPER_ADMIN) avec QR code puis codes de secours affichés une seule fois.
 */
export function TwoFactorStep({
  challenge,
  onDone,
  onRestart,
}: {
  challenge: TwoFactorChallenge;
  onDone: () => void;
  /** Jeton expiré ou épuisé : retour à l'identification. */
  onRestart: () => void;
}) {
  const t = useTranslations('auth.twoFactor');
  const describeError = useErrorMessage();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<{
    codes: string[];
    finish: () => Promise<void>;
  } | null>(null);
  const setup = useQuery({
    queryKey: ['two-factor-setup', challenge.challengeToken],
    queryFn: () => sessionStore.setupTwoFactor(challenge.challengeToken),
    enabled: challenge.twoFactor === 'SETUP',
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const fail = (error: unknown) => {
    if (isApiError(error) && error.code === 'TWO_FACTOR_CHALLENGE_INVALID') {
      toast.error(describeError(error));
      onRestart();
      return;
    }
    toast.error(describeError(error));
    setCode('');
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || code.trim() === '') return;
    setBusy(true);
    try {
      if (challenge.twoFactor === 'VERIFY') {
        await sessionStore.verifyTwoFactor(challenge.challengeToken, code);
        onDone();
      } else {
        const result = await sessionStore.confirmTwoFactor(challenge.challengeToken, code);
        setRecovery({ codes: result.recoveryCodes, finish: result.finish });
      }
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  if (recovery) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('recovery.title')}</h2>
        <RecoveryCodesPanel
          codes={recovery.codes}
          continueLabel={t('recovery.continue')}
          onContinue={async () => {
            await recovery.finish();
            onDone();
          }}
        />
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate data-testid="two-factor-step">
      <FieldGroup>
        <div className="flex items-start gap-3">
          <ShieldCheckIcon className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">
              {challenge.twoFactor === 'SETUP' ? t('setup.title') : t('verify.title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {challenge.twoFactor === 'SETUP' ? t('setup.description') : t('verify.description')}
            </p>
          </div>
        </div>

        {challenge.twoFactor === 'SETUP' &&
          (setup.data ? (
            <TwoFactorSetupView info={setup.data} />
          ) : setup.isError ? (
            <Button type="button" variant="outline" onClick={onRestart}>
              {t('restart')}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t('setup.loading')}</p>
          ))}

        {useRecovery ? (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="recovery-code">{t('verify.recoveryLabel')}</FieldLabel>
            <Input
              id="recovery-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              autoCapitalize="characters"
              dir="ltr"
              className="text-center font-mono tracking-widest"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="two-factor-code" className="self-center">
              {t('codeLabel')}
            </FieldLabel>
            <OtpCodeInput
              id="two-factor-code"
              value={code}
              onChange={setCode}
              onComplete={() => void submit()}
              disabled={busy || (challenge.twoFactor === 'SETUP' && !setup.data)}
            />
            <FieldDescription className="text-center">{t('codeHint')}</FieldDescription>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={busy || code.trim() === ''}>
          {challenge.twoFactor === 'SETUP' ? t('setup.submit') : t('verify.submit')}
        </Button>
        {challenge.twoFactor === 'VERIFY' && (
          <Button
            type="button"
            variant="link"
            className="self-center"
            onClick={() => {
              setUseRecovery((value) => !value);
              setCode('');
            }}
          >
            {useRecovery ? t('verify.useApp') : t('verify.useRecovery')}
          </Button>
        )}
        <Button type="button" variant="ghost" className="self-center" onClick={onRestart}>
          {t('back')}
        </Button>
      </FieldGroup>
    </form>
  );
}
