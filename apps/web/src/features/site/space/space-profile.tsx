'use client';

import {
  type ClientAccount,
  type ClientAddress,
  clientAccountUpdateSchema,
  clientAddressInputSchema,
} from '@traiteur/shared';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { LoadError } from '@/components/layout/load-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import {
  useClientAccount,
  useClientAddresses,
  useRemoveAddress,
  useSaveAddress,
  useUpdateAccount,
} from '../client-api';

const accountFormSchema = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    locale: z.enum(['fr', 'ar']),
  })
  .transform((values) => ({ ...values, email: values.email.trim() === '' ? null : values.email }))
  .pipe(clientAccountUpdateSchema);

/** Profil chez ce traiteur (nom, e-mail, langue des messages) et adresses enregistrées. */
export function SpaceProfile() {
  const account = useClientAccount();
  const addresses = useClientAddresses();
  if (account.isPending || addresses.isPending) return <Skeleton className="h-64 w-full" />;
  if (!account.data || !addresses.data) {
    return <LoadError error={account.error ?? addresses.error} backHref="/espace" />;
  }
  return (
    <div className="flex flex-col gap-4">
      <AccountForm account={account.data} />
      <Addresses addresses={addresses.data} />
    </div>
  );
}

function AccountForm({ account }: { account: ClientAccount }) {
  const t = useTranslations('site.space.profile');
  const describeError = useErrorMessage();
  const save = useUpdateAccount();
  const form = useZodForm(accountFormSchema, {
    firstName: account.firstName,
    lastName: account.lastName,
    email: account.email ?? '',
    locale: account.locale === 'ar' ? 'ar' : 'fr',
  });
  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync(input);
      form.reset(form.getValues());
      toast.success(t('saved'));
    } catch (error) {
      toast.error(describeError(error));
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4"
          data-testid="client-profile"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="firstName"
              label={t('firstName')}
              render={(field, { invalid }) => (
                <Input {...field} dir="auto" aria-invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              label={t('lastName')}
              render={(field, { invalid }) => (
                <Input {...field} dir="auto" aria-invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="email"
              label={t('email')}
              render={(field, { invalid }) => (
                <Input {...field} type="email" dir="ltr" aria-invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="locale"
              label={t('locale')}
              description={t('localeHint')}
              render={(field) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={field.id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="ar">العربية</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('phone')} : <span dir="ltr">{account.phone}</span>
          </p>
          <Button type="submit" className="self-start" disabled={form.formState.isSubmitting}>
            {t('save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const addressFormSchema = clientAddressInputSchema;

function Addresses({ addresses }: { addresses: ClientAddress[] }) {
  const t = useTranslations('site.space.profile');
  const describeError = useErrorMessage();
  const save = useSaveAddress();
  const remove = useRemoveAddress();
  const [adding, setAdding] = useState(false);
  const form = useZodForm(addressFormSchema, {
    label: '',
    address: '',
    city: '',
    isDefault: addresses.length === 0,
  });
  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: null, input });
      form.reset({ label: '', address: '', city: '', isDefault: false });
      setAdding(false);
    } catch (error) {
      toast.error(describeError(error));
    }
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">{t('addresses')}</CardTitle>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            {t('addAddress')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {addresses.length === 0 && !adding && (
          <p className="text-muted-foreground">{t('noAddress')}</p>
        )}
        <ul className="flex flex-col gap-2" data-testid="client-addresses">
          {addresses.map((address) => (
            <li key={address.id} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 flex-1 flex-col" dir="auto">
                <span className="font-medium">
                  {address.label}
                  {address.isDefault ? ` · ${t('default')}` : ''}
                </span>
                <span className="text-sm text-muted-foreground">
                  {address.address}, {address.city}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('removeAddress', { label: address.label })}
                onClick={() =>
                  void remove
                    .mutateAsync(address.id)
                    .catch((error: unknown) => toast.error(describeError(error)))
                }
              >
                <Trash2Icon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        {adding && (
          <form
            onSubmit={onSubmit}
            noValidate
            className="flex flex-col gap-3 rounded-lg border p-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="label"
                label={t('addressLabel')}
                render={(field, { invalid }) => (
                  <Input {...field} dir="auto" aria-invalid={invalid} />
                )}
              />
              <FormField
                control={form.control}
                name="city"
                label={t('city')}
                render={(field, { invalid }) => (
                  <Input {...field} dir="auto" aria-invalid={invalid} />
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="address"
              label={t('address')}
              render={(field, { invalid }) => (
                <Input {...field} dir="auto" aria-invalid={invalid} />
              )}
            />
            <Controller
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                  {t('makeDefault')}
                </label>
              )}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t('saveAddress')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
