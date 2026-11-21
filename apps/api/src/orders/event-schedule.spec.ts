import { civilSchedule, dayColumn, dayOf, sameSchedule, scheduleData } from './event-schedule';

const CASABLANCA = 'Africa/Casablanca';

describe('horaire civil des commandes', () => {
  it('jour civil ↔ colonne DATE, sans dépendre du fuseau de la machine', () => {
    expect(dayColumn('2026-11-21').toISOString()).toBe('2026-11-21T00:00:00.000Z');
    expect(dayOf(dayColumn('2026-11-21'))).toBe('2026-11-21');
    expect(dayOf(dayColumn('2026-12-31'))).toBe('2026-12-31');
  });

  it.each([
    // Jour, début, fin, fin le lendemain : le jour stocké est toujours celui saisi
    ['2026-11-21', '19:00', null, false],
    ['2026-11-21', '00:30', '03:00', false],
    ['2026-11-21', '23:30', '02:00', true],
    ['2026-06-17', '00:15', null, false], // UTC+1 avant le 20/09/2026 : instant la veille en UTC
  ] as const)('%s %s : jour et heures enregistrés tels que saisis', (day, start, end, next) => {
    const data = scheduleData(
      { eventDate: day, startTime: start, endTime: end, endsNextDay: next },
      CASABLANCA,
    );
    expect(dayOf(data.eventDay)).toBe(day);
    expect(civilSchedule(data)).toEqual({
      eventDate: day,
      startTime: start,
      endTime: end,
      endsNextDay: next,
    });
  });

  it('instants dérivés dans le fuseau du traiteur (Maroc à UTC+0 depuis le 20/09/2026)', () => {
    const after = scheduleData(
      { eventDate: '2026-11-21', startTime: '19:00', endTime: '02:00', endsNextDay: true },
      CASABLANCA,
    );
    expect(after.eventDate.toISOString()).toBe('2026-11-21T19:00:00.000Z');
    expect(after.eventEndDate?.toISOString()).toBe('2026-11-22T02:00:00.000Z');
    const before = scheduleData(
      { eventDate: '2026-06-17', startTime: '00:15', endTime: null, endsNextDay: false },
      CASABLANCA,
    );
    // Jour civil : le 17 ; instant UTC : le 16 à 23:15 (UTC+1) — le jour ne glisse pas
    expect(before.eventDate.toISOString()).toBe('2026-06-16T23:15:00.000Z');
    expect(dayOf(before.eventDay)).toBe('2026-06-17');
  });

  it('« fin le lendemain » sans heure de fin : ignoré ; fin avant le début : refusée', () => {
    const data = scheduleData(
      { eventDate: '2026-11-21', startTime: '19:00', endTime: null, endsNextDay: true },
      CASABLANCA,
    );
    expect(data.endsNextDay).toBe(false);
    expect(() =>
      scheduleData(
        { eventDate: '2026-11-21', startTime: '19:00', endTime: '18:00', endsNextDay: false },
        CASABLANCA,
      ),
    ).toThrow();
  });

  it('même horaire : compare le jour civil et les heures', () => {
    const base = { eventDate: '2026-11-21', startTime: '19:00', endTime: null, endsNextDay: false };
    expect(sameSchedule(base, { ...base })).toBe(true);
    expect(sameSchedule(base, { ...base, eventDate: '2026-11-22' })).toBe(false);
    expect(sameSchedule(base, { ...base, endsNextDay: true })).toBe(true); // sans fin : ignoré
  });
});
