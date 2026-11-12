import { describe, expect, it } from 'vitest';

import { loginSchema, otpVerifySchema, passwordSchema } from './auth.schemas';
import { clientVerifySchema } from './client-auth.schemas';

describe('passwordSchema', () => {
  it('accepte un mot de passe avec lettres et chiffres', () => {
    expect(passwordSchema.safeParse('Password123!').success).toBe(true);
    expect(passwordSchema.safeParse('مرحبا12345').success).toBe(true);
  });

  it.each(['court1', 'sanschiffre', '12345678'])('refuse %s', (value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });
});

describe('clientVerifySchema', () => {
  const signup = {
    firstName: ' Salma ',
    lastName: 'Bennani',
    email: ' Client@Exemple.MA ',
    consent: true,
    privacyVersion: '2026-11.0123456789abcdef',
  };

  it('normalise le téléphone, le nom et l’e-mail de l’inscription', () => {
    const result = clientVerifySchema.parse({ phone: '06 12 34 56 78', code: '123456', signup });
    expect(result).toMatchObject({
      phone: '+212612345678',
      signup: { firstName: 'Salma', email: 'client@exemple.ma' },
    });
  });

  it('exige la case de consentement cochée', () => {
    const base = { phone: '0612345678', code: '123456' };
    expect(
      clientVerifySchema.safeParse({ ...base, signup: { ...signup, consent: false } }).success,
    ).toBe(false);
    const { consent: _consent, ...withoutConsent } = signup;
    expect(clientVerifySchema.safeParse({ ...base, signup: withoutConsent }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('rend le traiteur facultatif (connexion SUPER_ADMIN)', () => {
    expect(
      loginSchema.safeParse({ identifier: 'admin@plateforme.ma', password: 'x' }).success,
    ).toBe(true);
  });
});

describe('otpVerifySchema', () => {
  it('exige un code à 6 chiffres', () => {
    const base = { traiteurSlug: 'dar-diafa', phone: '0612345678' };
    expect(otpVerifySchema.safeParse({ ...base, code: '123456' }).success).toBe(true);
    expect(otpVerifySchema.safeParse({ ...base, code: '12345' }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ ...base, code: '12345a' }).success).toBe(false);
  });
});
