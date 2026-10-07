import { describe, expect, it } from 'vitest';

import {
  getLocalizedText,
  getTextDirection,
  isRtlLocale,
  localizedTextSchema,
  parseLocalizedText,
} from './localized-text';

describe('localizedTextSchema', () => {
  it('accepte un texte avec seulement le français', () => {
    expect(localizedTextSchema.safeParse({ fr: 'Pastilla' }).success).toBe(true);
  });

  it('accepte un texte complet fr / ar / en', () => {
    const result = localizedTextSchema.safeParse({ fr: 'Pastilla', ar: 'بسطيلة', en: 'Pastilla' });
    expect(result.success).toBe(true);
  });

  it('refuse un texte sans français', () => {
    expect(localizedTextSchema.safeParse({ ar: 'بسطيلة' }).success).toBe(false);
  });

  it('refuse un français vide ou composé uniquement d’espaces', () => {
    expect(localizedTextSchema.safeParse({ fr: '   ' }).success).toBe(false);
  });

  it('refuse une langue non supportée', () => {
    expect(localizedTextSchema.safeParse({ fr: 'Pastilla', es: 'Pastela' }).success).toBe(false);
  });

  it('supprime les espaces superflus', () => {
    expect(parseLocalizedText({ fr: '  Méchoui ' })).toEqual({ fr: 'Méchoui' });
  });
});

describe('getLocalizedText', () => {
  const text = { fr: 'Méchoui', ar: 'مشوي' };

  it('retourne la traduction demandée si elle existe', () => {
    expect(getLocalizedText(text, 'ar')).toBe('مشوي');
  });

  it('se replie sur le français si la traduction manque', () => {
    expect(getLocalizedText(text, 'en')).toBe('Méchoui');
  });
});

describe('direction du texte', () => {
  it("considère l'arabe comme RTL", () => {
    expect(isRtlLocale('ar')).toBe(true);
    expect(getTextDirection('ar')).toBe('rtl');
  });

  it('considère le français et l’anglais comme LTR', () => {
    expect(getTextDirection('fr')).toBe('ltr');
    expect(getTextDirection('en')).toBe('ltr');
  });
});
