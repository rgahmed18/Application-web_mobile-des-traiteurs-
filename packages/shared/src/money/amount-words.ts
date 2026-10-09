/**
 * Montants en lettres, pour les documents (« Arrêtée la présente facture à la somme de… »).
 * Entrée : centimes (entier ≥ 0). Sortie en minuscules, sans majuscule initiale.
 *
 * Français : orthographe traditionnelle (traits d'union sous cent, « et » pour 21…71,
 * « quatre-vingts », « deux cents » mais « deux cent mille », « un million de dirhams »).
 * Arabe : arabe standard des factures marocaines, accord du nom compté (درهم / دراهم / درهمًا).
 */

const MAX_DIRHAMS = 999_999_999_999;

function split(cents: number): { dirhams: number; centimes: number } {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('Le montant doit être un entier positif en centimes');
  }
  const dirhams = Math.floor(cents / 100);
  if (dirhams > MAX_DIRHAMS) throw new RangeError('Montant trop élevé');
  return { dirhams, centimes: cents % 100 };
}

// ─────────────────────────── Français ───────────────────────────

const FR_UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
  'dix-sept',
  'dix-huit',
  'dix-neuf',
];
const FR_TENS = [
  '',
  '',
  'vingt',
  'trente',
  'quarante',
  'cinquante',
  'soixante',
  'soixante',
  'quatre-vingt',
  'quatre-vingt',
];

/** 0–99. `final` : rien ne suit (accord de « quatre-vingts »). */
function frBelowHundred(n: number, final: boolean): string {
  if (n < 20) return FR_UNITS[n] ?? '';
  const ten = Math.floor(n / 10);
  let unit = n % 10;
  const base = FR_TENS[ten] ?? '';
  // 70–79 et 90–99 : soixante-dix…, quatre-vingt-dix…
  if (ten === 7 || ten === 9) unit += 10;
  if (unit === 0) return ten === 8 && final ? 'quatre-vingts' : base;
  if (unit === 1 && ten !== 8 && ten !== 9) return `${base} et un`;
  if (unit === 11 && ten === 7) return `${base} et onze`;
  return `${base}-${FR_UNITS[unit] ?? ''}`;
}

/** 0–999. `final` : rien ne suit (accord de « cents » et « quatre-vingts »). */
function frBelowThousand(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) {
    const cent = hundreds === 1 ? 'cent' : `${FR_UNITS[hundreds] ?? ''} cent`;
    parts.push(rest === 0 && hundreds > 1 && final ? `${cent}s` : cent);
  }
  if (rest > 0 || hundreds === 0) parts.push(frBelowHundred(rest, final));
  return parts.join(' ');
}

function frNumber(n: number): string {
  if (n === 0) return 'zéro';
  const groups: [number, string, boolean][] = [
    [1_000_000_000, 'milliard', true],
    [1_000_000, 'million', true],
    [1_000, 'mille', false],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, word, isNoun] of groups) {
    const count = Math.floor(rest / size);
    rest %= size;
    if (count === 0) continue;
    if (isNoun) {
      // « million » et « milliard » sont des noms : accord et « cents » / « quatre-vingts » final
      parts.push(`${frBelowThousand(count, true)} ${word}${count > 1 ? 's' : ''}`);
    } else {
      // « mille » est invariable et ne prend pas « un » devant
      parts.push(count === 1 ? 'mille' : `${frBelowThousand(count, false)} mille`);
    }
  }
  if (rest > 0) parts.push(frBelowThousand(rest, true));
  return parts.join(' ');
}

export function amountToWordsFr(cents: number): string {
  const { dirhams, centimes } = split(cents);
  const parts: string[] = [];
  if (dirhams > 0 || centimes === 0) {
    const words = frNumber(dirhams);
    // « un million de dirhams » : « de » après million / milliard en fin de nombre
    const of = dirhams >= 1_000_000 && dirhams % 1_000_000 === 0 ? ' de' : '';
    parts.push(`${words}${of} ${dirhams > 1 ? 'dirhams' : 'dirham'}`);
  }
  if (centimes > 0) {
    parts.push(`${frNumber(centimes)} ${centimes > 1 ? 'centimes' : 'centime'}`);
  }
  return parts.join(' et ');
}

// ─────────────────────────── Arabe ───────────────────────────

const AR_UNITS = [
  '',
  'واحد',
  'اثنان',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
  'عشرة',
];
const AR_TEENS = [
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر',
];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];

function arBelowHundred(n: number): string {
  if (n <= 10) return AR_UNITS[n] ?? '';
  if (n < 20) return AR_TEENS[n - 10] ?? '';
  const unit = n % 10;
  const ten = AR_TENS[Math.floor(n / 10)] ?? '';
  return unit === 0 ? ten : `${AR_UNITS[unit] ?? ''} و${ten}`;
}

/** 1–999 ; `construct` : « مائتا » devant un nom (مائتا ألف). */
function arBelowThousand(n: number, construct = false): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) {
    parts.push(hundreds === 2 && rest === 0 && construct ? 'مائتا' : (AR_HUNDREDS[hundreds] ?? ''));
  }
  if (rest > 0) parts.push(arBelowHundred(rest));
  return parts.join(' و');
}

interface ArNoun {
  one: string; // درهم واحد / ألف
  two: string; // درهمان / ألفان
  plural: string; // 3–10 : دراهم / آلاف
  accusative: string; // 11–99 : درهمًا / ألفًا
  singular: string; // 100, 1000… : درهم / ألف
}

/** Groupes (milliers, millions…) : formes d'annexion quand le nom de la monnaie suit directement. */
interface ArGroup extends ArNoun {
  twoConstruct: string; // ألفا (درهم)
}

const AR_THOUSAND: ArGroup = {
  one: 'ألف',
  two: 'ألفان',
  twoConstruct: 'ألفا',
  plural: 'آلاف',
  accusative: 'ألفًا',
  singular: 'ألف',
};
const AR_MILLION: ArGroup = {
  one: 'مليون',
  two: 'مليونان',
  twoConstruct: 'مليونا',
  plural: 'ملايين',
  accusative: 'مليونًا',
  singular: 'مليون',
};
const AR_BILLION: ArGroup = {
  one: 'مليار',
  two: 'ملياران',
  twoConstruct: 'مليارا',
  plural: 'مليارات',
  accusative: 'مليارًا',
  singular: 'مليار',
};

/**
 * Groupe compté (« ثلاثة آلاف », « أحد عشر ألفًا »). `construct` : rien ne suit dans le nombre,
 * le nom de la monnaie vient juste après (« ألفا درهم », « أحد عشر ألف درهم »).
 */
function arCounted(count: number, noun: ArGroup, construct: boolean): string {
  if (count === 1) return noun.one;
  if (count === 2) return construct ? noun.twoConstruct : noun.two;
  const lastTwo = count % 100;
  const words = arBelowThousand(count, true);
  if (lastTwo >= 3 && lastTwo <= 10) return `${words} ${noun.plural}`;
  if (lastTwo >= 11) return `${words} ${construct ? noun.singular : noun.accusative}`;
  return `${words} ${noun.singular}`;
}

/** Nombre en lettres ; `construct` : le nom de la monnaie suit (formes d'annexion finales). */
function arNumber(n: number, construct = false): string {
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  let rest = n;
  for (const [size, noun] of [
    [1_000_000_000, AR_BILLION],
    [1_000_000, AR_MILLION],
    [1_000, AR_THOUSAND],
  ] as const) {
    const count = Math.floor(rest / size);
    rest %= size;
    if (count > 0) parts.push(arCounted(count, noun, construct && rest === 0));
  }
  if (rest > 0) parts.push(arBelowThousand(rest, construct));
  return parts.join(' و');
}

/** Nom de la monnaie selon le nombre : درهم واحد، درهمان، ثلاثة دراهم، أحد عشر درهمًا… */
function arWithNoun(n: number, noun: ArNoun & { zero: string }): string {
  if (n === 0) return `صفر ${noun.zero}`;
  if (n === 1) return `${noun.one} واحد`;
  if (n === 2) return noun.two;
  const lastTwo = n % 100;
  // Centaine ou groupe exact (200, 2 000, 11 000…) : le nom suit en annexion
  const words = arNumber(n, lastTwo === 0);
  if (lastTwo >= 3 && lastTwo <= 10) return `${words} ${noun.plural}`;
  if (lastTwo >= 11) return `${words} ${noun.accusative}`;
  return `${words} ${noun.singular}`;
}

const AR_DIRHAM = {
  zero: 'درهم',
  one: 'درهم',
  two: 'درهمان',
  plural: 'دراهم',
  accusative: 'درهمًا',
  singular: 'درهم',
};
const AR_CENTIME = {
  zero: 'سنتيم',
  one: 'سنتيم',
  two: 'سنتيمان',
  plural: 'سنتيمات',
  accusative: 'سنتيمًا',
  singular: 'سنتيم',
};

export function amountToWordsAr(cents: number): string {
  const { dirhams, centimes } = split(cents);
  const parts: string[] = [];
  if (dirhams > 0 || centimes === 0) parts.push(arWithNoun(dirhams, AR_DIRHAM));
  if (centimes > 0) parts.push(arWithNoun(centimes, AR_CENTIME));
  return parts.join(' و');
}

export function amountToWords(cents: number, locale: 'fr' | 'ar'): string {
  return locale === 'ar' ? amountToWordsAr(cents) : amountToWordsFr(cents);
}
