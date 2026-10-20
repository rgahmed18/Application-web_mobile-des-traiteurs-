import { describe, expect, it } from 'vitest';

import { DEFAULT_EVENT_TYPES, eventTypeSchema } from '../enums';
import { catalogListCode } from './catalog-lists.schemas';

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
