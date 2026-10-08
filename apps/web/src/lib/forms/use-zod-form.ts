'use client';

import { toNestErrors } from '@hookform/resolvers';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
  type DefaultValues,
  type FieldValues,
  type Resolver,
  useForm,
  type UseFormReturn,
} from 'react-hook-form';
import type { z } from 'zod';

import { translateIssue } from './translate-issue';

/**
 * Resolver react-hook-form fondé sur un schéma Zod partagé, avec messages traduits.
 * Le formulaire manipule l'entrée du schéma ; onSubmit reçoit la sortie validée (transformée).
 */
export function useZodResolver<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
): Resolver<z.input<TSchema>, unknown, z.output<TSchema>> {
  const t = useTranslations('validation');

  return useMemo<Resolver<z.input<TSchema>, unknown, z.output<TSchema>>>(
    () => async (values, _context, options) => {
      const result = await schema.safeParseAsync(values, { reportInput: true });
      if (result.success) return { values: result.data, errors: {} };

      const flatErrors: Record<string, { type: string; message: string }> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.map(String).join('.');
        if (flatErrors[path]) continue; // première erreur de chaque champ
        const { key, values: params } = translateIssue(issue);
        flatErrors[path] = { type: issue.code, message: t(key, params) };
      }
      return {
        values: {},
        errors: toNestErrors<z.input<TSchema>>(flatErrors, options),
      };
    },
    [schema, t],
  );
}

/** useForm branché sur un schéma partagé : validation et messages cohérents avec l'API. */
export function useZodForm<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
  defaultValues: DefaultValues<z.input<TSchema>>,
): UseFormReturn<z.input<TSchema>, unknown, z.output<TSchema>> {
  const resolver = useZodResolver(schema);
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    resolver,
    defaultValues,
    mode: 'onTouched',
  });
}
