import { describe, expect, it } from 'vitest';

import { lineLabelInputSchema, lineLabelKey, lineLabelSchema, lineLabelText } from './line-label';

describe('libellés de ligne', () => {
  it('garde toutes les langues saisies, ignore les traductions vides', () => {
    expect(lineLabelInputSchema.parse({ fr: ' Pastilla ', ar: 'بسطيلة', en: '' })).toEqual({
      fr: 'Pastilla',
      ar: 'بسطيلة',
    });
  });

  it('ligne libre en arabe seulement : le texte arabe sert aussi de repli', () => {
    expect(lineLabelInputSchema.parse({ ar: 'كعكة العرس' })).toEqual({
      fr: 'كعكة العرس',
      ar: 'كعكة العرس',
    });
  });

  it('refuse un libellé vide dans toutes les langues', () => {
    expect(lineLabelInputSchema.safeParse({ fr: ' ', ar: '' }).success).toBe(false);
    expect(lineLabelSchema.safeParse({ ar: 'x' }).success).toBe(false);
  });

  it('affichage dans la langue du document, repli sur le français', () => {
    const label = { fr: 'Thé à la menthe', ar: 'شاي بالنعناع' };
    expect(lineLabelText(label, 'ar')).toBe('شاي بالنعناع');
    expect(lineLabelText({ fr: 'Briouates' }, 'ar')).toBe('Briouates');
    expect(lineLabelText(label, 'en')).toBe('Thé à la menthe');
  });

  it('comparaison indépendante de l’ordre des clés', () => {
    expect(lineLabelKey({ ar: 'ب', fr: 'a' })).toBe(lineLabelKey({ fr: 'a', ar: 'ب' }));
    expect(lineLabelKey({ fr: 'a' })).not.toBe(lineLabelKey({ fr: 'a', ar: 'ب' }));
  });
});
