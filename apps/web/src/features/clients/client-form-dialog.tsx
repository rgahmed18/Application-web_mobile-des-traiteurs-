'use client';

import {
  type Client,
  clientAddressInputSchema,
  clientCreateSchema,
  clientUpdateSchema,
  localeSchema,
} from '@traiteur/shared';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormDialog } from '@/components/forms/form-dialog';
import { FormField } from '@/components/forms/form-field';
import { PhoneInput } from '@/components/forms/phone-input';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useCreateClient, useUpdateClient } from './clients-api';

const nullable = (value: string) => (value.trim() === '' ? null : value.trim());
const toTags = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
  ),
];

const baseFields = {
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  locale: localeSchema,
  tags: z.string(),
  internalNotes: z.string(),
};

const toBase = (values: {
  firstName: string;
  lastName: string;
  email: string;
  locale: z.infer<typeof localeSchema>;
  tags: string;
  internalNotes: string;
}) => ({
  firstName: values.firstName,
  lastName: values.lastName,
  email: nullable(values.email),
  locale: values.locale,
  tags: toTags(values.tags),
  internalNotes: nullable(values.internalNotes),
});

/** Création : téléphone et première adresse facultative, validés par le schéma partagé. */
const createFormSchema = z
  .object({
    ...baseFields,
    phone: z.string(),
    addressLine: z.string(),
    city: z.string(),
  })
  .transform((values) => ({
    ...toBase(values),
    phone: values.phone,
    address:
      values.addressLine.trim() === '' && values.city.trim() === ''
        ? null
        : { label: 'Domicile', address: values.addressLine, city: values.city, isDefault: true },
  }))
  .pipe(clientCreateSchema.extend({ address: clientAddressInputSchema.nullable() }));

const updateFormSchema = z.object(baseFields).transform(toBase).pipe(clientUpdateSchema);

interface ClientFormDialogProps {
  client?: Client;
  onClose: () => void;
  /** Client créé (ou existant choisi) : utilisé par le formulaire de commande. */
  onSaved?: (client: Client) => void;
  /** Le numéro est déjà un client : proposer d'ouvrir sa fiche (ou de le choisir). */
  onExisting?: (clientId: string) => void;
}

export function ClientFormDialog({ client, onClose, onSaved, onExisting }: ClientFormDialogProps) {
  return client ? (
    <EditClientDialog client={client} onClose={onClose} onSaved={onSaved} />
  ) : (
    <CreateClientDialog onClose={onClose} onSaved={onSaved} onExisting={onExisting} />
  );
}

function CommonFields({
  control,
}: {
  // Les deux formulaires partagent ces champs (mêmes noms et types)
  control: ReturnType<typeof useZodForm<typeof updateFormSchema>>['control'];
}) {
  const t = useTranslations('clients');
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="firstName"
          label={t('fields.firstName')}
          render={(field, { invalid }) => (
            <Input {...field} autoComplete="off" aria-invalid={invalid} />
          )}
        />
        <FormField
          control={control}
          name="lastName"
          label={t('fields.lastName')}
          render={(field, { invalid }) => (
            <Input {...field} autoComplete="off" aria-invalid={invalid} />
          )}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="email"
          label={t('fields.email')}
          render={(field, { invalid }) => (
            <Input {...field} type="email" dir="ltr" autoComplete="off" aria-invalid={invalid} />
          )}
        />
        <FormField
          control={control}
          name="locale"
          label={t('fields.locale')}
          render={(field) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['fr', 'ar'] as const).map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {t(`locales.${locale}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <FormField
        control={control}
        name="tags"
        label={t('fields.tags')}
        description={t('fields.tagsHint')}
        render={(field, { invalid }) => <Input {...field} aria-invalid={invalid} />}
      />
      <FormField
        control={control}
        name="internalNotes"
        label={t('fields.internalNotes')}
        description={t('fields.internalNotesHint')}
        render={(field, { invalid }) => <Textarea {...field} rows={3} aria-invalid={invalid} />}
      />
    </>
  );
}

function CreateClientDialog({
  onClose,
  onSaved,
  onExisting,
}: Omit<ClientFormDialogProps, 'client'>) {
  const t = useTranslations('clients');
  const describeError = useErrorMessage();
  const create = useCreateClient();
  const form = useZodForm(createFormSchema, {
    phone: '',
    firstName: '',
    lastName: '',
    email: '',
    locale: 'fr',
    tags: '',
    internalNotes: '',
    addressLine: '',
    city: '',
  });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      const created = await create.mutateAsync(input);
      toast.success(t('form.created'));
      onSaved?.(created);
      onClose();
    } catch (error) {
      const existingId =
        isApiError(error) &&
        error.code === 'CLIENT_EXISTS' &&
        typeof error.details.clientId === 'string'
          ? error.details.clientId
          : null;
      if (existingId && onExisting) {
        toast.error(t('form.exists'), {
          action: { label: t('form.openExisting'), onClick: () => onExisting(existingId) },
        });
        return;
      }
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('form.newTitle')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <FormField
        control={form.control}
        name="phone"
        label={t('fields.phone')}
        description={t('fields.phoneHint')}
        render={(field, { invalid }) => <PhoneInput {...field} aria-invalid={invalid} />}
      />
      <CommonFields
        control={
          form.control as unknown as ReturnType<
            typeof useZodForm<typeof updateFormSchema>
          >['control']
        }
      />
      <Separator />
      <p className="font-medium">{t('form.firstAddress')}</p>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <FormField
          control={form.control}
          name="addressLine"
          label={t('fields.address')}
          render={(field, { invalid }) => <Input {...field} aria-invalid={invalid} />}
        />
        <FormField
          control={form.control}
          name="city"
          label={t('fields.city')}
          render={(field, { invalid }) => <Input {...field} aria-invalid={invalid} />}
        />
      </div>
    </FormDialog>
  );
}

function EditClientDialog({
  client,
  onClose,
  onSaved,
}: Required<Pick<ClientFormDialogProps, 'client' | 'onClose'>> &
  Pick<ClientFormDialogProps, 'onSaved'>) {
  const t = useTranslations('clients');
  const describeError = useErrorMessage();
  const update = useUpdateClient();
  const form = useZodForm(updateFormSchema, {
    firstName: client.firstName,
    lastName: client.lastName,
    email: client.email ?? '',
    locale: client.locale,
    tags: client.tags.join(', '),
    internalNotes: client.internalNotes ?? '',
  });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      const saved = await update.mutateAsync({ id: client.id, input });
      toast.success(t('form.saved'));
      onSaved?.(saved);
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('form.editTitle')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <CommonFields control={form.control} />
    </FormDialog>
  );
}
