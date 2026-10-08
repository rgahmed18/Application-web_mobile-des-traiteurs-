'use client';

import { otpCodeSchema, passwordSchema, phoneSchema } from '@traiteur/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { OtpCodeInput } from '@/components/forms/otp-code-input';
import { PasswordInput } from '@/components/forms/password-input';
import { PhoneInput } from '@/components/forms/phone-input';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldGroup } from '@/components/ui/field';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { LOGIN_PATH } from './redirect';
import { sessionStore } from './session-store';
import { useResendCountdown } from './use-resend-countdown';

const phoneFormSchema = z.object({ phone: phoneSchema });
const resetFormSchema = z
  .object({ code: otpCodeSchema, newPassword: passwordSchema, confirmPassword: z.string() })
  .superRefine((values, ctx) => {
    if (values.newPassword !== values.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Les mots de passe diffèrent',
        params: { i18n: 'passwordsMismatch' },
      });
    }
  });

/** Mot de passe oublié : numéro, puis code SMS et nouveau mot de passe. */
export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const describeError = useErrorMessage();
  const router = useRouter();
  const [phone, setPhone] = useState<string | null>(null);
  const countdown = useResendCountdown();
  const phoneForm = useZodForm(phoneFormSchema, { phone: '' });
  const resetForm = useZodForm(resetFormSchema, { code: '', newPassword: '', confirmPassword: '' });

  async function sendCode(normalizedPhone: string) {
    try {
      const { retryAfterSeconds } = await sessionStore.requestOtp(
        normalizedPhone,
        'PASSWORD_RESET',
      );
      setPhone(normalizedPhone);
      countdown.start(retryAfterSeconds);
    } catch (error) {
      if (isApiError(error) && error.retryAfterSeconds) countdown.start(error.retryAfterSeconds);
      toast.error(describeError(error));
    }
  }

  const onSubmitPhone = phoneForm.handleSubmit(({ phone: value }) => sendCode(value));
  const onSubmitReset = resetForm.handleSubmit(async ({ code, newPassword }) => {
    if (!phone) return;
    try {
      await sessionStore.resetPassword(phone, code, newPassword);
      toast.success(t('forgot.success'));
      router.replace(LOGIN_PATH);
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <div className="flex flex-col gap-4">
      {!phone ? (
        <form onSubmit={onSubmitPhone} noValidate>
          <FieldGroup>
            <FormField
              control={phoneForm.control}
              name="phone"
              label={t('otp.phone')}
              render={(field, { invalid }) => (
                <PhoneInput
                  {...field}
                  placeholder={t('otp.phonePlaceholder')}
                  aria-invalid={invalid}
                />
              )}
            />
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={phoneForm.formState.isSubmitting || countdown.seconds > 0}
            >
              {countdown.seconds > 0
                ? t('otp.resendIn', { seconds: countdown.seconds })
                : t('otp.sendCode')}
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <form onSubmit={onSubmitReset} noValidate>
          <FieldGroup>
            <FieldDescription className="text-center text-base">
              {t('otp.codeSent', { phone: '⁦' + phone + '⁩' })}
            </FieldDescription>
            <FormField
              control={resetForm.control}
              name="code"
              label={t('otp.code')}
              render={(field, { invalid }) => (
                <OtpCodeInput
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  invalid={invalid}
                />
              )}
            />
            <FormField
              control={resetForm.control}
              name="newPassword"
              label={t('forgot.newPassword')}
              description={t('forgot.passwordRules')}
              render={(field, { invalid }) => (
                <PasswordInput {...field} autoComplete="new-password" aria-invalid={invalid} />
              )}
            />
            <FormField
              control={resetForm.control}
              name="confirmPassword"
              label={t('forgot.confirmPassword')}
              render={(field, { invalid }) => (
                <PasswordInput {...field} autoComplete="new-password" aria-invalid={invalid} />
              )}
            />
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={resetForm.formState.isSubmitting}
            >
              {t('forgot.submit')}
            </Button>
            <Button
              type="button"
              variant="link"
              disabled={countdown.seconds > 0}
              onClick={() => void sendCode(phone)}
            >
              {countdown.seconds > 0
                ? t('otp.resendIn', { seconds: countdown.seconds })
                : t('otp.resend')}
            </Button>
          </FieldGroup>
        </form>
      )}
      <Button asChild variant="link" className="self-center">
        <Link href={LOGIN_PATH}>{t('forgot.backToLogin')}</Link>
      </Button>
    </div>
  );
}
