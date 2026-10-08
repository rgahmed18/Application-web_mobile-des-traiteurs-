import { describe, expect, it } from 'vitest';

import { loginSchema, otpVerifySchema, passwordSchema, registerSchema } from './auth.schemas';

describe('passwordSchema', () => {
  it('accepte un mot de passe avec lettres et chiffres', () => {
    expect(passwordSchema.safeParse('Password123!').success).toBe(true);
    expect(passwordSchema.safeParse('مرحبا12345').success).toBe(true);
  });

  it.each(['court1', 'sanschiffre', '12345678'])('refuse %s', (value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('normalise le téléphone, le slug et l’email', () => {
    const result = registerSchema.parse({
      traiteurSlug: 'Dar-Diafa',
      phone: '06 12 34 56 78',
      code: '123456',
      email: ' Client@Exemple.MA ',
      password: 'Password123!',
      firstName: ' Salma ',
      lastName: 'Bennani',
    });
    expect(result).toMatchObject({
      traiteurSlug: 'dar-diafa',
      phone: '+212612345678',
      email: 'client@exemple.ma',
      firstName: 'Salma',
    });
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
