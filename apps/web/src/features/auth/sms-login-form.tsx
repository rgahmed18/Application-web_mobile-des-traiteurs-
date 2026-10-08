'use client';

import { otpCodeSchema, phoneSchema } from '@traiteur/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { OtpCodeInput } from '@/components/forms/otp-code-input';
import { PhoneInput } from '@/components/forms/phone-input';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldGroup } from '@/components/ui/field';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { sessionStore } from './session-store';
import { useResendCountdown } from './use-resend-countdown';

const phoneFormSchema = z.object({ phone: phoneSchema });
const codeFormSchema = z.object({ code: otpCodeSchema });

/** Connexion par code SMS en deux étapes : numéro, puis code à 6 chiffres. */
export function SmsLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations('auth.otp');
  const describeError = useErrorMessage();
  const [phone, setPhone] = useState<string | null>(null);
  const countdown = useResendCountdown();
  const phoneForm = useZodForm(phoneFormSchema, { phone: '' });
  const codeForm = useZodForm(codeFormSchema, { code: '' });

  async function sendCode(normalizedPhone: string) {
    try {
      const { retryAfterSeconds } = await sessionStore.requestOtp(normalizedPhone, 'LOGIN');
      setPhone(normalizedPhone);
      countdown.start(retryAfterSeconds);
    } catch (error) {
      if (isApiError(error) && error.retryAfterSeconds) countdown.start(error.retryAfterSeconds);
      toast.error(describeError(error));
    }
  }

  const onSubmitPhone = phoneForm.handleSubmit(({ phone: value }) => sendCode(value));

  const onSubmitCode = codeForm.handleSubmit(async ({ code }) => {
    if (!phone) return;
    try {
      await sessionStore.loginWithOtp(phone, code);
      onSuccess();
    } catch (error) {
      toast.error(describeError(error));
      codeForm.reset({ code: '' });
    }
  });

  if (!phone) {
    return (
      <form onSubmit={onSubmitPhone} noValidate>
        <FieldGroup>
          <FormField
            control={phoneForm.control}
            name="phone"
            label={t('phone')}
            render={(field, { invalid }) => (
              <PhoneInput {...field} placeholder={t('phonePlaceholder')} aria-invalid={invalid} />
            )}
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={phoneForm.formState.isSubmitting || countdown.seconds > 0}
          >
            {countdown.seconds > 0 ? t('resendIn', { seconds: countdown.seconds }) : t('sendCode')}
          </Button>
        </FieldGroup>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitCode} noValidate>
      <FieldGroup>
        <FieldDescription className="text-center text-base">
          {t('codeSent', { phone: '⁦' + phone + '⁩' })}
        </FieldDescription>
        <FormField
          control={codeForm.control}
          name="code"
          label={t('code')}
          render={(field, { invalid }) => (
            <OtpCodeInput
              id={field.id}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              onComplete={() => void onSubmitCode()}
              invalid={invalid}
              disabled={codeForm.formState.isSubmitting}
            />
          )}
        />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={codeForm.formState.isSubmitting}
        >
          {t('verify')}
        </Button>
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="link" onClick={() => setPhone(null)}>
            {t('changeNumber')}
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={countdown.seconds > 0}
            onClick={() => void sendCode(phone)}
          >
            {countdown.seconds > 0 ? t('resendIn', { seconds: countdown.seconds }) : t('resend')}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
