import type { z } from 'zod';

/**
 * Traduit une erreur de validation Zod en message de l'interface, à partir de sa nature
 * (code, bornes, format, champ) et non de son texte : les schémas partagés gardent leurs
 * messages français pour l'API, l'interface affiche la langue de l'utilisateur.
 */
export type ValidationMessageKey =
  | 'required'
  | 'tooShort'
  | 'tooLong'
  | 'invalidNumber'
  | 'minValue'
  | 'maxValue'
  | 'invalidPhone'
  | 'invalidEmail'
  | 'invalidCode'
  | 'passwordWeak'
  | 'passwordsMismatch'
  | 'maxGuestsBelowMin'
  | 'duplicateDish'
  | 'invalidAmount'
  | 'invalid';

export interface TranslatedIssue {
  key: ValidationMessageKey;
  values?: Record<string, number>;
}

/** Clé de traduction imposée par un raffinement personnalisé : ctx.addIssue({ params: { i18n } }). */
const CUSTOM_KEYS = new Set<ValidationMessageKey>([
  'required',
  'invalidPhone',
  'passwordsMismatch',
  'invalidNumber',
  'invalid',
  'minValue',
  'maxValue',
  'maxGuestsBelowMin',
  'duplicateDish',
  'invalidAmount',
]);

function lastPathSegment(issue: z.core.$ZodIssue): string {
  const segment = issue.path.at(-1);
  return typeof segment === 'string' ? segment : '';
}

export function translateIssue(issue: z.core.$ZodIssue): TranslatedIssue {
  const field = lastPathSegment(issue).toLowerCase();

  switch (issue.code) {
    case 'too_small': {
      const minimum = Number(issue.minimum);
      if (issue.origin === 'string' || issue.origin === 'array') {
        return minimum <= 1 ? { key: 'required' } : { key: 'tooShort', values: { min: minimum } };
      }
      return { key: 'minValue', values: { min: minimum } };
    }
    case 'too_big': {
      const maximum = Number(issue.maximum);
      return issue.origin === 'string'
        ? { key: 'tooLong', values: { max: maximum } }
        : { key: 'maxValue', values: { max: maximum } };
    }
    case 'invalid_type': {
      // La valeur saisie n'est présente qu'avec l'option reportInput (activée par useZodResolver) ;
      // sinon, le message indique « received undefined » pour un champ absent.
      const missing =
        'input' in issue
          ? issue.input === undefined || issue.input === null || issue.input === ''
          : /received (undefined|null)/.test(issue.message);
      if (missing) return { key: 'required' };
      if (issue.expected === 'number' || issue.expected === 'int') {
        // Montant saisi illisible (« 25,5,0 ») : message dédié avec un exemple
        return field.startsWith('price') ? { key: 'invalidAmount' } : { key: 'invalidNumber' };
      }
      return { key: 'invalid' };
    }
    case 'invalid_format':
      if (issue.format === 'email') return { key: 'invalidEmail' };
      if (field === 'code') return { key: 'invalidCode' };
      if (field.includes('password')) return { key: 'passwordWeak' };
      return { key: 'invalid' };
    case 'custom': {
      const key: unknown = issue.params?.i18n;
      if (typeof key === 'string' && CUSTOM_KEYS.has(key as ValidationMessageKey)) {
        return { key: key as ValidationMessageKey };
      }
      return field.includes('phone') ? { key: 'invalidPhone' } : { key: 'invalid' };
    }
    default:
      return { key: 'invalid' };
  }
}
