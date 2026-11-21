import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REQUEST_RULES,
  earliestEventDate,
  guestsRuleError,
  requestRulesSchema,
} from './request-rules';

describe('règles des demandes en ligne', () => {
  it('défauts : 10 à 5 000 invités, 3 jours de délai', () => {
    expect(DEFAULT_REQUEST_RULES).toEqual({ minGuests: 10, maxGuests: 5000, leadDays: 3 });
    expect(requestRulesSchema.safeParse(DEFAULT_REQUEST_RULES).success).toBe(true);
  });

  it('nombre d’invités : sous le minimum, dans les limites, au-dessus du maximum', () => {
    const rules = { minGuests: 10, maxGuests: 500 };
    expect(guestsRuleError(9, rules)).toBe('belowMinimum');
    expect(guestsRuleError(10, rules)).toBeNull();
    expect(guestsRuleError(500, rules)).toBeNull();
    expect(guestsRuleError(501, rules)).toBe('aboveMaximum');
  });

  it('première date : aujourd’hui + délai, en traversant mois et années', () => {
    expect(earliestEventDate('2026-11-21', 3)).toBe('2026-11-24');
    expect(earliestEventDate('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('délai : de 1 à 365 jours', () => {
    expect(requestRulesSchema.safeParse({ ...DEFAULT_REQUEST_RULES, leadDays: 0 }).success).toBe(
      false,
    );
    expect(requestRulesSchema.safeParse({ ...DEFAULT_REQUEST_RULES, leadDays: 366 }).success).toBe(
      false,
    );
  });
});
