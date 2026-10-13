'use client';

import {
  type Account,
  ACCOUNT_LOCALES,
  accountUpdateSchema,
  passwordSchema,
} from '@traiteur/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { UnsavedChangesGuard } from '@/components/forms/unsaved-changes-guard';
import { LoadError } from '@/components/layout/load-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { refreshAccessToken, sessionStore } from '@/features/auth/session-store';
import { FormSection } from '@/features/catalog/components/form-layout';
import { setLocale } from '@/i18n/actions';
import { LOCALE_LABELS } from '@/i18n/config';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { changePassword, useAccount, useSaveAccount } from './settings-api';

/** Mon compte : nom, langue de l'interface et mot de passe (tout utilisateur connecté). */
export function AccountTab() {
  const account = useAccount();
  if (account.isPending) return <Skeleton className="h-64 w-full" />;
  if (!account.data) return <LoadError error={account.error} backHref="/admin" />;
  return (
    <div className="flex flex-col gap-4">
      <ProfileForm account={account.data} />
      <PasswordForm hasPassword={account.data.hasPassword} />
    </div>
  );
}

const profileValues = (account: Account) => ({
  firstName: account.firstName,
  lastName: account.lastName,
  locale: account.locale,
});

function ProfileForm({ account }: { account: Account }) {
  const t = useTranslations('settings.account');
  const tc = useTranslations('common');
  const router = useRouter();
  const describeError = useErrorMessage();
  const save = useSaveAccount();
  const form = useZodForm(accountUpdateSchema, profileValues(account));
  const onSubmit = form.handleSubmit(async (input) => {
    try {
      const saved = await save.mutateAsync(input);
      form.reset(profileValues(saved));
      // Nom affiché dans le menu : relu avec la session ; langue : appliquée tout de suite
      await refreshAccessToken();
      if (saved.locale !== account.locale) {
        await setLocale(saved.locale);
        router.refresh();
      }
      toast.success(t('saved'));
    } catch (error) {
      toast.error(describeError(error));
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate data-testid="account-profile">
      <UnsavedChangesGuard when={form.formState.isDirty} />
      <FormSection title={t('profileTitle')}>
        <p className="text-sm text-muted-foreground">
          {t('phone')} : <span dir="ltr">{account.phone}</span>
          {account.email && (
            <>
              {' · '}
              <span dir="ltr">{account.email}</span>
            </>
          )}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="firstName"
            label={t('firstName')}
            render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
          />
          <FormField
            control={form.control}
            name="lastName"
            label={t('lastName')}
            render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
          />
          <FormField
            control={form.control}
            name="locale"
            label={t('locale')}
            render={(field) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={field.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_LOCALES.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      <span lang={locale}>{LOCALE_LABELS[locale]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
            {form.formState.isSubmitting ? tc('saving') : tc('save')}
          </Button>
        </div>
      </FormSection>
    </form>
  );
}

const passwordFormSchema = z
  .object({ currentPassword: z.string(), newPassword: passwordSchema, confirm: z.string() })
  .refine((values) => values.newPassword === values.confirm, {
    path: ['confirm'],
    params: { i18n: 'passwordsMismatch' },
  });

function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations('settings.account');
  const describeError = useErrorMessage();
  const form = useZodForm(passwordFormSchema, {
    currentPassword: '',
    newPassword: '',
    confirm: '',
  });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await changePassword({
        currentPassword: hasPassword ? values.currentPassword : null,
        newPassword: values.newPassword,
      });
      toast.success(t('passwordChanged'));
      // Toutes les sessions sont fermées par le serveur : reconnexion avec le nouveau mot de passe
      await sessionStore.logout().catch(() => undefined);
    } catch (error) {
      toast.error(describeError(error));
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate data-testid="account-password">
      <FormSection title={t('passwordTitle')} description={t('passwordHint')}>
        <div className="grid gap-4 sm:grid-cols-3">
          {hasPassword && (
            <FormField
              control={form.control}
              name="currentPassword"
              label={t('currentPassword')}
              render={(field, { invalid }) => (
                <Input
                  {...field}
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                  aria-invalid={invalid}
                />
              )}
            />
          )}
          <FormField
            control={form.control}
            name="newPassword"
            label={t('newPassword')}
            render={(field, { invalid }) => (
              <Input
                {...field}
                type="password"
                autoComplete="new-password"
                dir="ltr"
                aria-invalid={invalid}
              />
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            label={t('confirmPassword')}
            render={(field, { invalid }) => (
              <Input
                {...field}
                type="password"
                autoComplete="new-password"
                dir="ltr"
                aria-invalid={invalid}
              />
            )}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('changePassword')}
          </Button>
        </div>
      </FormSection>
    </form>
  );
}
