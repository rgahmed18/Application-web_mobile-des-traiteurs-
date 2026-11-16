import { describe, expect, it } from 'vitest';

import { DEFAULT_EVENT_TYPES, eventTypeSchema } from '../enums';
import { catalogListCode, catalogListItemInputSchema } from './catalog-lists.schemas';

describe('catalogListCode', () => {
  it('donne un code stable, sans accents, en majuscules', () => {
    expect(catalogListCode('Soutenance de thèse')).toBe('SOUTENANCE_DE_THESE');
    expect(catalogListCode('  Fête — été ')).toBe('FETE_ETE');
  });

  it('commence toujours par une lettre et reste un code valide', () => {
    expect(catalogListCode('2e anniversaire')).toBe('T_2E_ANNIVERSAIRE');
    for (const name of ['Mariage', 'عرس', '100 % luxe', 'x'.repeat(80)]) {
      const code = catalogListCode(name) || 'T';
      expect(eventTypeSchema.safeParse(code).success).toBe(true);
    }
  });
});

describe('types d’événement par défaut', () => {
  it('comprennent la soutenance et sont des codes valides', () => {
    expect(DEFAULT_EVENT_TYPES).toContain('THESIS');
    for (const code of DEFAULT_EVENT_TYPES) expect(eventTypeSchema.parse(code)).toBe(code);
  });
});

describe('nom d’un élément de liste', () => {
  const input = (name: object) => ({ name, description: null, isActive: true });

  it('exige le français ET l’arabe (affiché sur le site client dans les deux langues)', () => {
    expect(
      catalogListItemInputSchema.safeParse(input({ fr: 'Baptême', ar: 'عمادة' })).success,
    ).toBe(true);
    const missing = catalogListItemInputSchema.safeParse(input({ fr: 'Baptême' }));
    expect(missing.error?.issues[0]?.path).toEqual(['name', 'ar']);
    expect(catalogListItemInputSchema.safeParse(input({ fr: 'Baptême', ar: '  ' })).success).toBe(
      false,
    );
  });
});
