import { parseSnapshot } from './quote-snapshot';

/** Devis envoyé avant les types d'événement gérables : le nom du type n'était pas figé. */
const legacy = {
  v: 1,
  issuedOn: '2026-10-01',
  orderReference: 'CMD-2026-00001',
  seller: { name: 'Dar Diafa', phone: '+212522000000', email: 'contact@dar-diafa.ma' },
  client: { name: 'Salma Bennani', phone: '+212600000005', email: null },
  event: {
    type: 'WEDDING',
    date: '2026-11-14',
    startTime: '20:00',
    endTime: '02:00',
    endsNextDay: true,
    guestCount: 120,
    venueName: 'Salle Les Jasmins',
    venueAddress: '8, avenue Hassan II',
    city: 'Casablanca',
  },
  terms: { fr: null, ar: null },
  schedule: [{ kind: 'FULL', amount: 100_000, dueDate: null }],
};

describe('parseSnapshot : nom du type d’événement', () => {
  it('donne aux anciens devis le nom par défaut de leur code', () => {
    expect(parseSnapshot(legacy)?.event.typeName).toEqual({ fr: 'Mariage', ar: 'عرس' });
  });

  it('garde le nom figé à l’envoi, même si la liste du traiteur change ensuite', () => {
    const frozen = {
      ...legacy,
      event: { ...legacy.event, type: 'HENNE', typeName: { fr: 'Henné', ar: 'حناء' } },
    };
    expect(parseSnapshot(frozen)?.event.typeName).toEqual({ fr: 'Henné', ar: 'حناء' });
  });

  it('affiche au moins le code d’un ancien type inconnu', () => {
    const unknown = { ...legacy, event: { ...legacy.event, type: 'SPECIAL' } };
    expect(parseSnapshot(unknown)?.event.typeName).toEqual({ fr: 'SPECIAL' });
  });
});
