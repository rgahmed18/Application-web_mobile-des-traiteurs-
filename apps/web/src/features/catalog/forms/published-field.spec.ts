import { describe, expect, it } from 'vitest';

import { publicationIssues } from './published-field';

const complete = {
  name: { fr: 'Formule Aqiqa', ar: 'عرض العقيقة' },
  description: { fr: 'Pastilla, méchoui', ar: 'بسطيلة، مشوي' },
  imageKey: 'traiteurs/x/catalog/y',
};

describe('publicationIssues : ce qui manque avant de publier sur le site', () => {
  it('fiche complète : aucun avertissement', () => {
    expect(publicationIssues(complete, true)).toEqual([]);
  });

  it('photo, description et arabe manquants', () => {
    expect(
      publicationIssues(
        { name: { fr: 'ZRDA', ar: '' }, description: { fr: '', ar: '' }, imageKey: null },
        true,
      ),
    ).toEqual(['photo', 'description', 'arabic']);
  });

  it('description sans traduction arabe ; service sans photo : pas d’avertissement de photo', () => {
    const service = { ...complete, description: { fr: 'Décoration', ar: ' ' }, imageKey: null };
    expect(publicationIssues(service, false)).toEqual(['arabic']);
  });
});
