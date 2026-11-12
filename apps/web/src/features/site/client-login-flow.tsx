'use client';

import {
  type ClientConsentInput,
  type ClientSignupInput,
  type OtpChannel,
  otpCodeSchema,
  phoneSchema,
} from '@traiteur/shared';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { type Control, Controller, type FieldPath, type FieldValues } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { OtpCodeInput } from '@/components/forms/otp-code-input';
import { PhoneInput } from '@/components/forms/phone-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldDescription, FieldError, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useResendCountdown } from '@/features/auth/use-resend-countdown';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { clientSessionStore } from './client-session-store';
import { usePublicPrivacy } from './site-api';

type Step = 'phone' | 'code' | 'signup' | 'consent';

const optionalEmail = z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email())]);
const phoneFormSchema = z.object({ phone: phoneSchema, email: optionalEmail });
const codeFormSchema = z.object({ code: otpCodeSchema });
const consentFormSchema = z.object({
  consent: z.boolean().refine((value) => value, { params: { i18n: 'consentRequired' } }),
});
const signupFormSchema = consentFormSchema.extend({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: optionalEmail,
});

/** Où le code a été envoyé : SMS au numéro, ou e-mail (numéro étranger). */
interface Destination {
  phone: string;
  email: string | null;
  channel: OtpChannel;
}

/**
 * Connexion et inscription des clients, sans mot de passe : numéro (et e-mail si le numéro ne
 * reçoit pas de SMS), code, puis, si l'API le demande, inscription ou consentement seul. Un
 * compte inconnu et un compte connu chez un autre traiteur suivent exactement le même chemin.
 */
export function ClientLoginFlow({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useTranslations('site.login');
  const locale = useLocale() === 'ar' ? 'ar' : 'fr';
  const describeError = useErrorMessage();
  const privacy = usePublicPrivacy();
  const countdown = useResendCountdown();
  const [step, setStep] = useState<Step>('phone');
  const [needsEmail, setNeedsEmail] = useState(false);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [code, setCode] = useState('');
  const [knownName, setKnownName] = useState<string | null>(null);
  const phoneForm = useZodForm(phoneFormSchema, { phone: '', email: '' });
  const codeForm = useZodForm(codeFormSchema, { code: '' });
  const signupForm = useZodForm(signupFormSchema, {
    firstName: '',
    lastName: '',
    email: '',
    consent: false,
  });
  const consentForm = useZodForm(consentFormSchema, { consent: false });

  async function sendCode(phone: string, email: string | null) {
    try {
      const sent = await clientSessionStore.requestCode({
        phone,
        ...(email ? { email } : {}),
        locale,
      });
      setDestination({
        phone,
        email: sent.channel === 'EMAIL' ? email : null,
        channel: sent.channel,
      });
      codeForm.reset({ code: '' });
      setStep('code');
      countdown.start(sent.retryAfterSeconds);
    } catch (error) {
      if (isApiError(error) && error.code === 'EMAIL_REQUIRED') {
        setNeedsEmail(true);
        toast.info(describeError(error));
        return;
      }
      if (isApiError(error) && error.retryAfterSeconds) countdown.start(error.retryAfterSeconds);
      toast.error(describeError(error));
    }
  }

  /** Vérifie le code, avec l'inscription ou le consentement quand l'API les a demandés. */
  async function verify(
    value: string,
    extra: { signup?: ClientSignupInput; consent?: ClientConsentInput } = {},
  ) {
    if (!destination) return;
    try {
      await clientSessionStore.verify({
        phone: destination.phone,
        ...(destination.email ? { email: destination.email } : {}),
        code: value,
        ...extra,
      });
      onSignedIn();
    } catch (error) {
      if (isApiError(error) && error.code === 'SIGNUP_REQUIRED') {
        signupForm.reset({ firstName: '', lastName: '', email: '', consent: false });
        setStep('signup');
        return;
      }
      if (isApiError(error) && error.code === 'CONSENT_REQUIRED') {
        const firstName = error.details.firstName;
        setKnownName(typeof firstName === 'string' ? firstName : null);
        setStep('consent');
        return;
      }
      if (isApiError(error) && error.code === 'PRIVACY_POLICY_CHANGED') await privacy.refetch();
      if (isApiError(error) && ['INVALID_OTP', 'OTP_LOCKED'].includes(error.code)) {
        codeForm.reset({ code: '' });
        setStep('code');
      }
      toast.error(describeError(error));
    }
  }

  const privacyVersion = privacy.data?.version;
  const consentLabel = t.rich('consent', {
    link: (chunks) => (
      <Link
        href="/confidentialite"
        target="_blank"
        className="font-medium underline underline-offset-4"
      >
        {chunks}
      </Link>
    ),
  });

  if (step === 'phone' || !destination) {
    const onSubmit = phoneForm.handleSubmit(({ phone, email }) => sendCode(phone, email || null));
    return (
      <FlowCard title={t('title')} description={t('subtitle')}>
        <form onSubmit={onSubmit} noValidate data-testid="client-login-phone">
          <FieldGroup>
            <FormField
              control={phoneForm.control}
              name="phone"
              label={t('phone')}
              description={t('phoneHint')}
              render={(field, { invalid }) => (
                <PhoneInput {...field} placeholder={t('phonePlaceholder')} aria-invalid={invalid} />
              )}
            />
            {needsEmail && (
              <FormField
                control={phoneForm.control}
                name="email"
                label={t('email')}
                description={t('emailForCode')}
                render={(field, { invalid }) => (
                  <Input
                    {...field}
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    aria-invalid={invalid}
                  />
                )}
              />
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={phoneForm.formState.isSubmitting || countdown.seconds > 0}
            >
              {countdown.seconds > 0
                ? t('resendIn', { seconds: countdown.seconds })
                : t('sendCode')}
            </Button>
          </FieldGroup>
        </form>
      </FlowCard>
    );
  }

  if (step === 'code') {
    const onSubmit = codeForm.handleSubmit(async ({ code: value }) => {
      setCode(value);
      await verify(value);
    });
    const shown = destination.channel === 'EMAIL' ? destination.email : destination.phone;
    return (
      <FlowCard title={t('codeTitle')}>
        <form onSubmit={onSubmit} noValidate data-testid="client-login-code">
          <FieldGroup>
            <FieldDescription className="text-center text-base">
              {t(destination.channel === 'EMAIL' ? 'codeSentEmail' : 'codeSentSms', {
                destination: '⁦' + (shown ?? '') + '⁩',
              })}
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
                  onComplete={() => void onSubmit()}
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
              <Button type="button" variant="link" onClick={() => setStep('phone')}>
                {t('changeNumber')}
              </Button>
              <Button
                type="button"
                variant="link"
                disabled={countdown.seconds > 0}
                onClick={() => void sendCode(destination.phone, destination.email)}
              >
                {countdown.seconds > 0
                  ? t('resendIn', { seconds: countdown.seconds })
                  : t('resend')}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </FlowCard>
    );
  }

  if (step === 'signup') {
    const onSubmit = signupForm.handleSubmit(async (values) => {
      if (!privacyVersion) return void toast.error(t('privacyUnavailable'));
      await verify(code, {
        signup: {
          firstName: values.firstName,
          lastName: values.lastName,
          // Numéro étranger : l'adresse qui a reçu le code
          ...(!destination.email && values.email ? { email: values.email } : {}),
          locale,
          consent: true,
          privacyVersion,
        },
      });
    });
    return (
      <FlowCard title={t('signupTitle')} description={t('signupSubtitle')}>
        <form onSubmit={onSubmit} noValidate data-testid="client-signup">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={signupForm.control}
                name="firstName"
                label={t('firstName')}
                render={(field, { invalid }) => (
                  <Input {...field} dir="auto" autoComplete="given-name" aria-invalid={invalid} />
                )}
              />
              <FormField
                control={signupForm.control}
                name="lastName"
                label={t('lastName')}
                render={(field, { invalid }) => (
                  <Input {...field} dir="auto" autoComplete="family-name" aria-invalid={invalid} />
                )}
              />
            </div>
            {!destination.email && (
              <FormField
                control={signupForm.control}
                name="email"
                label={t('emailOptional')}
                render={(field, { invalid }) => (
                  <Input
                    {...field}
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    aria-invalid={invalid}
                  />
                )}
              />
            )}
            <ConsentCheckbox control={signupForm.control} label={consentLabel} />
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={signupForm.formState.isSubmitting}
            >
              {t('createAccount')}
            </Button>
          </FieldGroup>
        </form>
      </FlowCard>
    );
  }

  // Fiche déjà connue du traiteur (créée au back-office) : accord demandé une seule fois
  const onSubmitConsent = consentForm.handleSubmit(async () => {
    if (!privacyVersion) return void toast.error(t('privacyUnavailable'));
    await verify(code, { consent: { consent: true, privacyVersion } });
  });
  return (
    <FlowCard
      title={knownName ? t('consentTitleNamed', { name: knownName }) : t('consentTitle')}
      description={t('consentSubtitle')}
    >
      <form onSubmit={onSubmitConsent} noValidate data-testid="client-consent">
        <FieldGroup>
          <ConsentCheckbox control={consentForm.control} label={consentLabel} />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={consentForm.formState.isSubmitting}
          >
            {t('continue')}
          </Button>
        </FieldGroup>
      </form>
    </FlowCard>
  );
}

function FlowCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Case de consentement : jamais cochée d'avance, lien vers la politique du traiteur. */
function ConsentCheckbox<TValues extends FieldValues & { consent: boolean }>({
  control,
  label,
}: {
  control: Control<TValues, unknown, FieldValues>;
  label: ReactNode;
}) {
  const tv = useTranslations('validation');
  return (
    <Controller
      control={control}
      name={'consent' as FieldPath<TValues>}
      render={({ field, fieldState }) => (
        <div className="flex flex-col gap-1">
          <label className="flex items-start gap-3 text-sm leading-relaxed">
            <Checkbox
              checked={field.value === true}
              onCheckedChange={(checked) => field.onChange(checked === true)}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              className="mt-0.5"
              data-testid="privacy-consent"
            />
            <span>{label}</span>
          </label>
          {fieldState.invalid && <FieldError>{tv('consentRequired')}</FieldError>}
        </div>
      )}
    />
  );
}
