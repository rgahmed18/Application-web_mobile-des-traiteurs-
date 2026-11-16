import { describe, expect, it } from 'vitest';

import { listShownIn } from './site-lists';

describe('listShownIn : une liste sans arabe n’apparaît pas en français sur le site arabe', () => {
  const bapteme = { name: { fr: 'Baptême' } };
  const mariage = { name: { fr: 'Mariage', ar: 'عرس' } };

  it('en arabe : seulement les noms traduits', () => {
    expect(listShownIn('ar', mariage)).toBe(true);
    expect(listShownIn('ar', bapteme)).toBe(false);
  });

  it('en français : tout', () => {
    expect(listShownIn('fr', bapteme)).toBe(true);
  });
});
