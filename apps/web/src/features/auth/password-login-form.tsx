'use client';

import { loginSchema } from '@traiteur/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { FormField } from '@/components/forms/form-field';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { sessionStore } from './session-store';

const formSchema = loginSchema.pick({ identifier: true, password: true });

/** Connexion par téléphone (ou email) et mot de passe. */
export function PasswordLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations('auth.login');
  const describeError = useErrorMessage();
  const form = useZodForm(formSchema, { identifier: '', password: '' });

  const onSubmit = form.handleSubmit(async ({ identifier, password }) => {
    try {
      await sessionStore.loginWithPassword(identifier, password);
      onSuccess();
    } catch (error) {
      toast.error(describeError(error));
      form.resetField('password');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormField
          control={form.control}
          name="identifier"
          label={t('identifier')}
          render={(field, { invalid }) => (
            <Input
              {...field}
              autoComplete="username"
              placeholder={t('identifierPlaceholder')}
              dir="ltr"
              aria-invalid={invalid}
            />
          )}
        />
        <FormField
          control={form.control}
          name="password"
          label={t('password')}
          render={(field, { invalid }) => (
            <PasswordInput {...field} autoComplete="current-password" aria-invalid={invalid} />
          )}
        />
        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
          {t('submit')}
        </Button>
        <Button asChild variant="link" className="self-center">
          <Link href="/admin/forgot-password">{t('forgotPassword')}</Link>
        </Button>
      </FieldGroup>
    </form>
  );
}
