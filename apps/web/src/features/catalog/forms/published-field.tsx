'use client';

import { TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type Control, Controller, type FieldValues, type Path, useWatch } from 'react-hook-form';

import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

import type { LocalizedFormValue } from './form-values';

/** Champs lus pour les avertissements de publication. */
interface PublishableValues {
  name: LocalizedFormValue;
  description: LocalizedFormValue;
  imageKey?: string | null;
  isPublished: boolean;
}

export type PublicationIssue = 'photo' | 'description' | 'arabic';

/**
 * Ce qui manque pour une belle fiche sur le site client : photo (si l'élément en a une),
 * description, traduction arabe du nom ou de la description.
 */
export function publicationIssues(
  values: Pick<PublishableValues, 'name' | 'description' | 'imageKey'>,
  withPhoto: boolean,
): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  if (withPhoto && !values.imageKey) issues.push('photo');
  const description = values.description.fr.trim();
  if (description === '') issues.push('description');
  if (values.name.ar.trim() === '' || (description !== '' && values.description.ar.trim() === '')) {
    issues.push('arabic');
  }
  return issues;
}

/**
 * « Publié sur le site » : distinct de « Disponible » (un élément peut être commandé au
 * back-office sans être montré aux clients). Avertit, sans bloquer, de ce qui manque à la fiche.
 */
export function PublishedField<T extends FieldValues & PublishableValues>({
  control,
  id,
  withPhoto,
}: {
  control: Control<T, unknown, FieldValues>;
  id: string;
  /** L'élément a une photo (menus, buffets, matériel ; pas les services). */
  withPhoto: boolean;
}) {
  const t = useTranslations('catalog.published');
  const [name, description, imageKey] = useWatch({
    control,
    name: ['name', 'description', 'imageKey'] as Path<T>[],
  }) as unknown as [LocalizedFormValue, LocalizedFormValue, string | null | undefined];
  const issues = publicationIssues({ name, description, imageKey }, withPhoto);

  return (
    <Controller
      control={control}
      name={'isPublished' as Path<T>}
      render={({ field }) => (
        <div className="flex flex-col gap-2">
          <Field orientation="horizontal">
            <Switch
              id={id}
              checked={field.value}
              onCheckedChange={field.onChange}
              data-testid="published-switch"
            />
            <FieldContent>
              <FieldLabel htmlFor={id} className="text-base">
                {t('label')}
              </FieldLabel>
              <FieldDescription>{t('hint')}</FieldDescription>
            </FieldContent>
          </Field>
          {issues.length > 0 && (
            <div
              role={field.value ? 'alert' : undefined}
              className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
              data-testid="publication-issues"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">
                  {field.value ? t('issuesPublished') : t('issuesBefore')}
                </p>
                <ul className="list-disc ps-5">
                  {issues.map((issue) => (
                    <li key={issue}>{t(`issues.${issue}`)}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    />
  );
}
