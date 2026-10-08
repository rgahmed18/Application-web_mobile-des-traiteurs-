import {
  localizedTextSchema,
  loginSchema,
  otpCodeSchema,
  passwordSchema,
  phoneSchema,
} from '@traiteur/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { translateIssue } from './translate-issue';

/** Première erreur traduite d'une saisie invalide. */
function firstIssue(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('Une erreur était attendue');
  const issue = result.error.issues[0];
  if (!issue) throw new Error('Aucune erreur');
  return translateIssue(issue);
}

describe('translateIssue', () => {
  it('signale un champ obligatoire vide', () => {
    expect(firstIssue(loginSchema, { identifier: '', password: 'x' })).toEqual({
      key: 'required',
    });
    expect(firstIssue(localizedTextSchema, { fr: '' })).toEqual({ key: 'required' });
  });

  it('signale un champ absent comme obligatoire', () => {
    expect(firstIssue(z.object({ name: z.string() }), {})).toEqual({ key: 'required' });
  });

  it('traduit les règles du mot de passe sans reprendre le message français du schéma', () => {
    expect(firstIssue(z.object({ password: passwordSchema }), { password: 'abc' })).toEqual({
      key: 'tooShort',
      values: { min: 8 },
    });
    expect(
      firstIssue(z.object({ newPassword: passwordSchema }), { newPassword: 'abcdefghij' }),
    ).toEqual({ key: 'passwordWeak' });
  });

  it('reconnaît un téléphone et un code SMS invalides', () => {
    expect(firstIssue(z.object({ phone: phoneSchema }), { phone: '123' })).toEqual({
      key: 'invalidPhone',
    });
    expect(firstIssue(z.object({ code: otpCodeSchema }), { code: '12a' })).toEqual({
      key: 'invalidCode',
    });
  });

  it('traduit les bornes numériques', () => {
    expect(firstIssue(z.number().int().min(1), 0)).toEqual({ key: 'minValue', values: { min: 1 } });
    expect(firstIssue(z.number().max(10), 11)).toEqual({ key: 'maxValue', values: { max: 10 } });
    expect(firstIssue(z.number(), 'abc')).toEqual({ key: 'invalidNumber' });
  });

  it('utilise la clé imposée par un raffinement personnalisé', () => {
    const schema = z.string().superRefine((_value, ctx) => {
      ctx.addIssue({ code: 'custom', message: 'x', params: { i18n: 'passwordsMismatch' } });
    });
    expect(firstIssue(schema, 'a')).toEqual({ key: 'passwordsMismatch' });
  });
});
