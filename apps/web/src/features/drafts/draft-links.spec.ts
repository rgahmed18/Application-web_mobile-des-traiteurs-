import { DRAFT_FORMS, draftFormKey } from '@traiteur/shared';
import { describe, expect, it } from 'vitest';

import { draftHref, parseDraftKey } from './draft-links';

describe('liens « Reprendre » des brouillons', () => {
  it('chaque formulaire a sa page', () => {
    for (const form of DRAFT_FORMS) {
      expect(draftHref(draftFormKey(form, 'new'))).toMatch(/^\/admin\//);
    }
  });

  it('pages des formulaires en page et en fenêtre', () => {
    expect(draftHref('order:new')).toBe('/admin/orders/new');
    expect(draftHref('order:o1')).toBe('/admin/orders/o1/edit');
    expect(draftHref('dish:d1')).toBe('/admin/catalog/dishes/d1');
    expect(draftHref('client:c1')).toBe('/admin/clients/c1?draft=client%3Ac1');
    expect(draftHref('quote:o1')).toBe('/admin/orders/o1?draft=quote%3Ao1');
    expect(draftHref('settings:billing')).toBe('/admin/settings?tab=billing');
  });

  it('lecture d’une clé', () => {
    expect(parseDraftKey('equipment:new')).toEqual({ form: 'equipment', target: 'new' });
  });
});
