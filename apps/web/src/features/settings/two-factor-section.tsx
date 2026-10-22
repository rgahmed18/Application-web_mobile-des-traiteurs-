'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  recoveryCodesSchema,
  type TwoFactorSetupInfo,
  twoFactorSetupInfoSchema,
  twoFactorStatusSchema,
} from '@traiteur/shared';
import { ShieldCheckIcon, ShieldOffIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { OtpCodeInput } from '@/components/forms/otp-code-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { RecoveryCodesPanel } from '@/features/auth/recovery-codes-panel';
import { refreshAccessToken } from '@/features/auth/session-store';
import { TwoFactorSetupView } from '@/features/auth/two-factor-setup-view';
import { FormSection } from '@/features/catalog/components/form-layout';
import { apiRequest } from '@/lib/api/client';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDateTime } from '@/lib/format/date';

const statusKey = ['me', 'two-factor'] as const;

type Mode = 'idle' | 'setup' | 'regenerate' | 'disable';

/**
 * « Mon compte » : double authentification. Imposée au super admin (activée dès sa première
 * connexion, jamais désactivable), facultative pour les administrateurs de traiteur.
 */
export function TwoFactorSection() {
  const t = useTranslations('settings.account.twoFactor');
  const describeError = useErrorMessage();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('idle');
  const [setupInfo, setSetupInfo] = useState<TwoFactorSetupInfo | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');

  const status = useQuery({
    queryKey: statusKey,
    queryFn: ({ signal }) =>
      apiRequest('/me/two-factor', { schema: twoFactorStatusSchema, signal }),
  });
  const reset = () => {
    setMode('idle');
    setSetupInfo(null);
    setCode('');
  };
  const done = async (message: string) => {
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: statusKey });
    // L'indicateur « double authentification active » du compte est relu
    await refreshAccessToken();
  };

  const begin = useMutation({
    mutationFn: () =>
      apiRequest('/me/two-factor/setup', { method: 'POST', schema: twoFactorSetupInfoSchema }),
    onSuccess: (info) => {
      setSetupInfo(info);
      setMode('setup');
    },
    onError: (error) => toast.error(describeError(error)),
  });
  const submit = useMutation({
    mutationFn: async (): Promise<string[] | null> => {
      if (mode === 'disable') {
        await apiRequest('/me/two-factor/disable', {
          method: 'POST',
          body: { code },
          schema: z.void(),
        });
        return null;
      }
      const path = mode === 'setup' ? '/me/two-factor/confirm' : '/me/two-factor/recovery-codes';
      return (
        await apiRequest(path, { method: 'POST', body: { code }, schema: recoveryCodesSchema })
      ).recoveryCodes;
    },
    onSuccess: async (recoveryCodes) => {
      const wasMode = mode;
      reset();
      if (recoveryCodes) setCodes(recoveryCodes);
      await done(
        wasMode === 'setup'
          ? t('enabled')
          : wasMode === 'disable'
            ? t('disabled')
            : t('regenerated'),
      );
    },
    onError: (error) => {
      toast.error(describeError(error));
      setCode('');
    },
  });

  if (status.isPending) return <Skeleton className="h-40 w-full" />;
  if (!status.data) return null;
  const { enabled, required, enabledAt, recoveryCodesRemaining } = status.data;

  return (
    <FormSection title={t('title')} description={required ? t('requiredHint') : t('optionalHint')}>
      <div className="flex flex-wrap items-center gap-3" data-testid="two-factor-status">
        {enabled ? (
          <Badge className="gap-1 bg-emerald-600 text-white">
            <ShieldCheckIcon aria-hidden />
            {t('statusOn')}
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <ShieldOffIcon aria-hidden />
            {t('statusOff')}
          </Badge>
        )}
        {enabled && enabledAt && (
          <span className="text-sm text-muted-foreground">
            {t('since', { date: formatDateTime(enabledAt) })} ·{' '}
            {t('remaining', { count: recoveryCodesRemaining })}
          </span>
        )}
      </div>

      {codes ? (
        <RecoveryCodesPanel
          codes={codes}
          continueLabel={t('codesStored')}
          onContinue={() => setCodes(null)}
        />
      ) : mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          {!enabled && (
            <Button type="button" onClick={() => begin.mutate()} disabled={begin.isPending}>
              {t('enable')}
            </Button>
          )}
          {enabled && (
            <Button type="button" variant="outline" onClick={() => setMode('regenerate')}>
              {t('regenerate')}
            </Button>
          )}
          {enabled && !required && (
            <Button type="button" variant="ghost" onClick={() => setMode('disable')}>
              {t('disable')}
            </Button>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim() !== '') submit.mutate();
          }}
        >
          {mode === 'setup' && setupInfo && <TwoFactorSetupView info={setupInfo} />}
          <p className="text-sm text-muted-foreground">
            {mode === 'setup'
              ? t('confirmHint')
              : mode === 'disable'
                ? t('disableHint')
                : t('regenerateHint')}
          </p>
          {mode === 'setup' ? (
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="account-two-factor-code" className="self-center">
                {t('code')}
              </FieldLabel>
              <OtpCodeInput id="account-two-factor-code" value={code} onChange={setCode} />
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:max-w-xs">
              <FieldLabel htmlFor="account-two-factor-proof">{t('codeOrRecovery')}</FieldLabel>
              <Input
                id="account-two-factor-proof"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                dir="ltr"
                className="font-mono"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={mode === 'disable' ? 'destructive' : 'default'}
              disabled={submit.isPending || code.trim() === ''}
            >
              {mode === 'setup'
                ? t('activate')
                : mode === 'disable'
                  ? t('disable')
                  : t('regenerate')}
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </FormSection>
  );
}
