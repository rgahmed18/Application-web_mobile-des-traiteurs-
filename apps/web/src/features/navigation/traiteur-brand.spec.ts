import { describe, expect, it } from 'vitest';

import { initialsOf } from './traiteur-brand';

describe('initiales du traiteur (marque blanche sans logo)', () => {
  it('deux premiers mots, lettres seulement', () => {
    expect(initialsOf('Dar Diafa Traiteur')).toBe('DD');
    expect(initialsOf('  l’Atelier   gourmand ')).toBe('LG');
    expect(initialsOf('دار الضيافة')).toBe('دا');
    expect(initialsOf('')).toBe('•');
  });
});
