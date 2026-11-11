'use client';

import {
  draftFormKey,
  type SiteSettings,
  siteSettingsSchema,
  siteSettingsVersion,
} from '@traiteur/shared';
import { TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/forms/form-field';
import { UnsavedChangesGuard } from '@/components/forms/unsaved-changes-guard';
import { Input } from '@/components/ui/input';
import { FormSection } from '@/features/catalog/components/form-layout';
import {
  fromLocalizedText,
  localizedFormSchema,
  toOptionalLocalizedText,
} from '@/features/catalog/forms/form-values';
import { LocalizedTextFields } from '@/features/catalog/forms/localized-text-fields';
import { DraftFields } from '@/features/drafts/draft-fields';
import { FormDraftNotice } from '@/features/drafts/form-draft-notice';
import { useEditConflict } from '@/features/drafts/use-edit-conflict';
import { useFormDraft } from '@/features/drafts/use-form-draft';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useSaveSiteSettings, useSiteSettings } from './settings-api';
import { Loaded, SaveBar, SwitchRow } from './settings-forms';
import { SitePhotosField } from './site-photos-field';

const siteFormSchema = z
  .object({
    requireClientApproval: z.boolean(),
    intro: localizedFormSchema,
    photoKeys: z.array(z.string()),
    privacyExtra: localizedFormSchema,
    cndpDeclaration: z.string(),
  })
  .transform((values): z.input<typeof siteSettingsSchema> => ({
    requireClientApproval: values.requireClientApproval,
    intro: toOptionalLocalizedText(values.intro),
    photoKeys: values.photoKeys,
    privacyExtra: toOptionalLocalizedText(values.privacyExtra),
    cndpDeclaration: values.cndpDeclaration,
  }))
  .pipe(siteSettingsSchema);

const siteValues = (settings: SiteSettings) => ({
  requireClientApproval: settings.requireClientApproval,
  intro: fromLocalizedText(settings.intro),
  photoKeys: settings.photoKeys,
  privacyExtra: fromLocalizedText(settings.privacyExtra),
  cndpDeclaration: settings.cndpDeclaration ?? '',
});

export function SiteTab() {
  const query = useSiteSettings();
  return (
    <Loaded query={query}>
      {(settings) => <SiteForm key={siteSettingsVersion(settings)} settings={settings} />}
    </Loaded>
  );
}

/**
 * Site client du traiteur : validation des nouveaux clients, accueil (présentation, photos) et
 * compléments de la politique de confidentialité générée.
 */
function SiteForm({ settings }: { settings: SiteSettings }) {
  const t = useTranslations('settings.site');
  const describeError = useErrorMessage();
  const save = useSaveSiteSettings();
  const form = useZodForm(siteFormSchema, siteValues(settings));
  // Brouillon côté serveur : enregistré toutes les quelques secondes, repris à la reconnexion
  const draft = useFormDraft({
    formKey: draftFormKey('settings', 'site'),
    form,
    label: () => null,
    baseVersion: siteSettingsVersion(settings),
  });
  const editConflict = useEditConflict(draft);
  const [uploading, setUploading] = useState(false);
  const approval = form.watch('requireClientApproval');
  const photoKeys = form.watch('photoKeys');
  const onSubmit = form.handleSubmit(async (input) => {
    try {
      form.reset(siteValues(await save.mutateAsync({ input, version: draft.expectedVersion })));
      await draft.clear();
      toast.success(t('saved'));
    } catch (error) {
      if (!editConflict(error)) toast.error(describeError(error));
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      data-testid="site-settings"
    >
      <FormDraftNotice draft={draft} />
      <DraftFields draft={draft}>
        <UnsavedChangesGuard when={form.formState.isDirty} />
        <FormSection title={t('clientsTitle')} description={t('clientsHint')}>
          <SwitchRow
            id="settings-client-approval"
            checked={approval}
            onChange={(checked) =>
              form.setValue('requireClientApproval', checked, { shouldDirty: true })
            }
            label={t('requireClientApproval')}
            hint={approval ? t('approvalOn') : t('approvalOff')}
          />
        </FormSection>
        <FormSection title={t('homeTitle')} description={t('homeHint')}>
          <LocalizedTextFields
            control={form.control}
            name="intro"
            labelFr={t('introFr')}
            labelAr={t('introAr')}
            description={t('introHint')}
            multiline
          />
          <SitePhotosField
            value={photoKeys}
            onChange={(next) => form.setValue('photoKeys', next, { shouldDirty: true })}
            onBusyChange={setUploading}
          />
        </FormSection>
        <FormSection title={t('privacyTitle')} description={t('privacyHint')}>
          <div
            role="note"
            className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
            data-testid="privacy-legal-review"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('legalReview')}</span>
          </div>
          <FormField
            control={form.control}
            name="cndpDeclaration"
            label={t('cndpDeclaration')}
            description={t('cndpHint')}
            render={(field, { invalid }) => (
              <Input {...field} dir="ltr" className="max-w-64" aria-invalid={invalid} />
            )}
          />
          <LocalizedTextFields
            control={form.control}
            name="privacyExtra"
            labelFr={t('privacyExtraFr')}
            labelAr={t('privacyExtraAr')}
            description={t('privacyExtraHint')}
            multiline
          />
        </FormSection>
        <SaveBar
          dirty={form.formState.isDirty}
          submitting={form.formState.isSubmitting || uploading}
          onReset={() => form.reset(siteValues(settings))}
        />
      </DraftFields>
    </form>
  );
}
