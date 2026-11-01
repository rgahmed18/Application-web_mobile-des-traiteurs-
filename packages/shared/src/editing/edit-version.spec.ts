import { describe, expect, it } from 'vitest';

import { availabilitySettingsSchema } from '../settings/settings.schemas';

import { contentVersion } from './edit-version';

describe('contentVersion', () => {
  it('indépendante de l’ordre des clés et des valeurs absentes', () => {
    expect(contentVersion({ a: 1, b: [1, 2], c: undefined })).toBe(
      contentVersion({ b: [1, 2], a: 1 }),
    );
  });

  it('change dès qu’une valeur change', () => {
    expect(contentVersion({ a: 1 })).not.toBe(contentVersion({ a: 2 }));
    expect(contentVersion({ a: [1, 2] })).not.toBe(contentVersion({ a: [2, 1] }));
    expect(contentVersion({ a: null })).not.toBe(contentVersion({ a: 'null' }));
  });

  it('même empreinte après un aller-retour JSON (API → navigateur)', () => {
    const settings = availabilitySettingsSchema.parse({
      maxEventsPerDay: null,
      closedWeekdays: [7, 1],
      missionRedactionDays: 30,
      equipmentSetupHours: 4,
      equipmentReturnHours: 2,
    });
    const received = availabilitySettingsSchema.parse(JSON.parse(JSON.stringify(settings)));
    expect(contentVersion(received)).toBe(contentVersion(settings));
  });
});
