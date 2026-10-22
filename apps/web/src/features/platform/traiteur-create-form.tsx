'use client';

import {
  DEFAULT_TRIAL_DAYS,
  type PlatformTraiteurCreateResult,
  platformTraiteurCreateSchema,
  slugify,
  SUBSCRIPTION_PLANS,
} from '@traiteur/shared';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { PhoneInput } from '@/components/forms/phone-input';
import { UnsavedChangesGuard } from '@/components/forms/unsaved-changes-guard';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormActions, FormHeader, FormSection } from '@/features/catalog/components/form-layout';
import { toInteger } from '@/features/catalog/forms/form-values';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatMoney } from '@/lib/format/money';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { AdminLinkDialog } from './admin-link-dialog';
import { useCreatePlatformTraiteur, usePlatformDashboard } from './platform-api';

const LIST_PATH = '/platform/traiteurs';

/** Saisie (textes) → schéma partagé de l'API : mêmes règles, mêmes chemins d'erreur. */
const formSchema = z
  .object({
    name: z.string(),
    slug: z.string(),
    email: z.string(),
    phone: z.string(),
    city: z.string(),
    plan: z.enum(SUBSCRIPTION_PLANS),
    locale: z.enum(['fr', 'ar']),
    trialDays: z.string(),
    admin: z.object({ firstName: z.string(), lastName: z.string(), phone: z.string() }),
  })
  .transform((values): z.input<typeof platformTraiteurCreateSchema> => ({
    ...values,
    trialDays: toInteger(values.trialDays),
  }))
  .pipe(platformTraiteurCreateSchema);

const EMPTY = {
  name: '',
  slug: '',
  email: '',
  phone: '',
  city: '',
  plan: 'PRO' as const,
  locale: 'fr' as const,
  trialDays: String(DEFAULT_TRIAL_DAYS),
  admin: { firstName: '', lastName: '', phone: '' },
};

/**
 * Nouveau traiteur : identité, offre et période d'essai, premier administrateur. Il reçoit un
 * lien d'activation de 7 jours (SMS si possible, sinon copie ou WhatsApp) ; aucun mot de passe
 * ne transite par la console.
 */
export function TraiteurCreateForm() {
  const t = useTranslations('platform.create');
  const locale = useLocale();
  const router = useRouter();
  const describeError = useErrorMessage();
  const create = useCreatePlatformTraiteur();
  const prices = usePlatformDashboard().data?.planPrices;
  const [created, setCreated] = useState<PlatformTraiteurCreateResult | null>(null);
  const slugEdited = useRef(false);
  const form = useZodForm(formSchema, EMPTY);
  const [name] = useWatch({ control: form.control, name: ['name'] });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      setCreated(await create.mutateAsync(input));
      form.reset(EMPTY);
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <UnsavedChangesGuard when={form.formState.isDirty && !created} />
      <FormHeader title={t('title')} backHref={LIST_PATH} />

      <FormSection title={t('sectionTraiteur')}>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            label={t('name')}
            render={(field, { invalid }) => (
              <Input
                {...field}
                dir="auto"
                aria-invalid={invalid}
                onChange={(event) => {
                  field.onChange(event);
                  if (!slugEdited.current) {
                    form.setValue('slug', slugify(event.target.value, ''), { shouldDirty: true });
                  }
                }}
              />
            )}
          />
          <FormField
            control={form.control}
            name="slug"
            label={t('slug')}
            description={t('slugHint', { slug: slugify(name, 'dar-diafa') })}
            render={(field, { invalid }) => (
              <Input
                {...field}
                dir="ltr"
                aria-invalid={invalid}
                onChange={(event) => {
                  slugEdited.current = true;
                  field.onChange(event);
                }}
              />
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
            name="phone"
            label={t('phone')}
            render={(field, { invalid }) => <PhoneInput {...field} aria-invalid={invalid} />}
          />
          <FormField
            control={form.control}
            name="city"
            label={t('city')}
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
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </FormSection>

      <FormSection title={t('sectionPlan')}>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="plan"
            label={t('plan')}
            render={(field) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={field.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBSCRIPTION_PLANS.map((plan) => (
                    <SelectItem key={plan} value={plan}>
                      {plan}
                      {prices &&
                        ` — ${t('perMonth', { price: formatMoney(prices[plan], locale) })}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FormField
            control={form.control}
            name="trialDays"
            label={t('trialDays')}
            description={t('trialHint')}
            render={(field, { invalid }) => (
              <Input
                {...field}
                inputMode="numeric"
                dir="ltr"
                className="md:w-40"
                aria-invalid={invalid}
              />
            )}
          />
        </div>
      </FormSection>

      <FormSection title={t('sectionAdmin')} description={t('adminHint')}>
        <div className="grid gap-4 md:grid-cols-3">
          <FormField
            control={form.control}
            name="admin.firstName"
            label={t('adminFirstName')}
            render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
          />
          <FormField
            control={form.control}
            name="admin.lastName"
            label={t('adminLastName')}
            render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
          />
          <FormField
            control={form.control}
            name="admin.phone"
            label={t('adminPhone')}
            render={(field, { invalid }) => <PhoneInput {...field} aria-invalid={invalid} />}
          />
        </div>
      </FormSection>

      <FormActions cancelHref={LIST_PATH} submitting={form.formState.isSubmitting} />
      <AdminLinkDialog
        result={created}
        onClose={() => {
          setCreated(null);
          router.push(LIST_PATH);
        }}
      />
    </form>
  );
}
