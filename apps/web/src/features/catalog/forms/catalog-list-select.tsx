'use client';

import type { CatalogList } from '@traiteur/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';

import { FormField } from '@/components/forms/form-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCatalogList } from '../catalog-api';
import { useLocalized } from '../use-localized';

const NONE = 'none';

/**
 * Choix dans une liste du catalogue (catégorie de matériel, gamme, type de buffet). Le champ
 * vaut '' sans choix (« noneLabel » : « Sans gamme », ou « Choisir… » pour un choix obligatoire,
 * imposé par le schéma du formulaire). Seuls les éléments actifs et non archivés sont proposés,
 * plus celui déjà porté par l'article (kept) ; liste vide : lien vers « Listes » pour la remplir.
 */
export function CatalogListSelect<T extends FieldValues>({
  control,
  name,
  list,
  label,
  noneLabel,
  kept,
}: {
  control: Control<T, unknown, FieldValues>;
  name: FieldPath<T>;
  list: CatalogList;
  label: string;
  noneLabel: string;
  kept: string | undefined;
}) {
  const t = useTranslations('catalog');
  const localized = useLocalized();
  const items = useCatalogList(list);
  const options = (items.data ?? []).filter(
    (item) => (item.isActive && !item.archived) || item.id === kept,
  );
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={
        items.data && options.length === 0 ? (
          <>
            {t('fields.emptyList')}{' '}
            <Link href="/admin/catalog/lists" className="underline underline-offset-2">
              {t('tabs.lists')}
            </Link>
          </>
        ) : undefined
      }
      render={(field, { invalid }) => {
        const value = typeof field.value === 'string' ? field.value : '';
        return (
          <Select
            value={value === '' ? NONE : value}
            onValueChange={(next) => field.onChange(next === NONE ? '' : next)}
          >
            <SelectTrigger id={field.id} className="w-full" aria-invalid={invalid}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{noneLabel}</SelectItem>
              {options.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {localized(item.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }}
    />
  );
}
