/**
 * Formules de démonstration (fictives) : une par gamme pour chaque type d'événement, pour que le
 * comparateur des gammes du site soit complet. Le nom de la gamme est toujours dans le nom de la
 * formule. Les formules historiques (Mariage, Fiançailles Premium, Aqiqa Essentiel) sont dans
 * seed.ts ; celles-ci les complètent.
 */

type Tier = 'STANDARD' | 'PREMIUM' | 'LUXE';
type Dishes = readonly (readonly [string, number])[];

export interface DemoMenu {
  slug: string;
  name: { fr: string; ar: string };
  description: { fr: string; ar: string };
  ttcPerPerson: number;
  minGuests: number;
  maxGuests: number;
  dishes: Dishes;
  range: Tier;
  eventTypes: string[];
}

const TIERS: Record<Tier, { slug: string; fr: string; ar: string }> = {
  STANDARD: { slug: 'essentiel', fr: 'Essentiel', ar: 'الأساسي' },
  PREMIUM: { slug: 'premium', fr: 'Premium', ar: 'الممتاز' },
  LUXE: { slug: 'luxe', fr: 'Luxe', ar: 'الفاخر' },
};

/** Compositions par gamme : de 4 plats (Essentiel) à 7 plats (Luxe). */
const DISHES: Record<Tier, Dishes> = {
  STANDARD: [
    ['salades-marocaines', 1],
    ['tajine-poulet-citron', 1],
    ['cornes-de-gazelle', 2],
    ['the-menthe', 1],
  ],
  PREMIUM: [
    ['salades-marocaines', 1],
    ['briouates-viande', 1],
    ['pastilla-poulet', 1],
    ['tajine-agneau-pruneaux', 1],
    ['chebakia', 2],
    ['the-menthe', 1],
  ],
  LUXE: [
    ['briouates-viande', 1],
    ['pastilla-fruits-de-mer', 1],
    ['mechoui', 1],
    ['tajine-agneau-pruneaux', 1],
    ['plateau-fruits', 1],
    ['cornes-de-gazelle', 2],
    ['the-menthe', 1],
  ],
};

interface EventSpec {
  code: string;
  slug: string;
  fr: string;
  ar: string;
  /** Prix TTC par personne : Essentiel, Premium, Luxe. */
  prices: Record<Tier, number>;
  guests: [number, number];
  /** Gammes déjà couvertes par une formule de seed.ts. */
  existing?: Tier[];
}

const EVENTS: EventSpec[] = [
  {
    code: 'ENGAGEMENT',
    slug: 'fiancailles',
    fr: 'Fiançailles',
    ar: 'الخطوبة',
    prices: { STANDARD: 200, PREMIUM: 250, LUXE: 340 },
    guests: [50, 300],
    existing: ['PREMIUM'],
  },
  {
    code: 'AQIQA',
    slug: 'aqiqa',
    fr: 'Aqiqa',
    ar: 'العقيقة',
    prices: { STANDARD: 180, PREMIUM: 240, LUXE: 320 },
    guests: [30, 200],
    existing: ['STANDARD'],
  },
  {
    code: 'BIRTHDAY',
    slug: 'anniversaire',
    fr: 'Anniversaire',
    ar: 'عيد الميلاد',
    prices: { STANDARD: 150, PREMIUM: 210, LUXE: 290 },
    guests: [20, 150],
  },
  {
    code: 'CORPORATE',
    slug: 'entreprise',
    fr: 'Entreprise',
    ar: 'حفل الشركة',
    prices: { STANDARD: 170, PREMIUM: 230, LUXE: 320 },
    guests: [30, 500],
  },
  {
    code: 'THESIS',
    slug: 'soutenance',
    fr: 'Soutenance',
    ar: 'مناقشة الأطروحة',
    prices: { STANDARD: 120, PREMIUM: 170, LUXE: 240 },
    guests: [20, 120],
  },
  {
    code: 'OTHER',
    slug: 'reception',
    fr: 'Réception',
    ar: 'الاستقبال',
    prices: { STANDARD: 160, PREMIUM: 220, LUXE: 300 },
    guests: [30, 400],
  },
];

const DESCRIPTIONS: Record<Tier, (event: EventSpec) => { fr: string; ar: string }> = {
  STANDARD: (event) => ({
    fr: `L’essentiel d’une belle table de ${event.fr.toLowerCase()}, généreux et fait maison.`,
    ar: `أساسيات مائدة ${event.ar} الجميلة، بسخاء ومن تحضيرنا.`,
  }),
  PREMIUM: (event) => ({
    fr: `Une table plus raffinée pour votre ${event.fr.toLowerCase()}, avec pastilla et tajine d’agneau.`,
    ar: `مائدة أرقى لـ${event.ar}، مع البسطيلة وطاجين اللحم.`,
  }),
  LUXE: (event) => ({
    fr: `Le grand menu de fête pour votre ${event.fr.toLowerCase()}, du méchoui aux pâtisseries.`,
    ar: `قائمة الاحتفال الكبرى لـ${event.ar}، من المشوي إلى الحلويات.`,
  }),
};

/** Formules complémentaires, par type d'événement et par gamme. */
export const DEMO_EVENT_MENUS: DemoMenu[] = EVENTS.flatMap((event) =>
  (['STANDARD', 'PREMIUM', 'LUXE'] as const)
    .filter((tier) => !event.existing?.includes(tier))
    .map((tier) => ({
      slug: `formule-${event.slug}-${TIERS[tier].slug}`,
      name: {
        fr: `Formule ${event.fr} ${TIERS[tier].fr}`,
        ar: `عرض ${event.ar} ${TIERS[tier].ar}`,
      },
      description: DESCRIPTIONS[tier](event),
      ttcPerPerson: event.prices[tier],
      minGuests: event.guests[0],
      maxGuests: event.guests[1],
      dishes: DISHES[tier],
      range: tier,
      eventTypes: [event.code],
    })),
);
