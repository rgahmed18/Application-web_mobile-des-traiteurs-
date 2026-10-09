/**
 * Dates au format JJ/MM/AAAA (et HH:mm), toujours dans le fuseau du traiteur et non dans
 * celui du navigateur : un événement du 21/11 à Casablanca reste le 21/11 partout.
 * Chiffres occidentaux dans les deux langues ; assemblage manuel pour un rendu identique
 * côté serveur et côté navigateur.
 */
export const DEFAULT_TIME_ZONE = 'Africa/Casablanca';

interface DateParts {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsInTimeZone(date: Date, timeZone: string): DateParts {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  const parts: DateParts = { day: '', month: '', year: '', hour: '', minute: '' };
  for (const part of formatter.formatToParts(date)) {
    if (part.type in parts) parts[part.type as keyof DateParts] = part.value;
  }
  return parts;
}

function toDate(value: Date | string): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError('Date invalide');
  return date;
}

/** « 21/11/2026 » */
export function formatDate(value: Date | string, timeZone = DEFAULT_TIME_ZONE): string {
  const { day, month, year } = partsInTimeZone(toDate(value), timeZone);
  return `${day}/${month}/${year}`;
}

/** « 21/11/2026 19:00 » */
export function formatDateTime(value: Date | string, timeZone = DEFAULT_TIME_ZONE): string {
  const { day, month, year, hour, minute } = partsInTimeZone(toDate(value), timeZone);
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

/** Jour civil « AAAA-MM-JJ » (déjà dans le fuseau du traiteur) → « JJ/MM/AAAA ». */
export function formatLocalDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

const intlLocale = (locale: string) => (locale === 'ar' ? 'ar-MA' : 'fr-FR');
const nameFormatters = new Map<string, Intl.DateTimeFormat>();

function nameFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = nameFormatters.get(key);
  if (!formatter) {
    // Noms seulement (jamais de chiffres) : pas de risque de chiffres arabes-indiens
    formatter = new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: 'UTC' });
    nameFormatters.set(key, formatter);
  }
  return formatter;
}

const atNoonUtc = (date: string) => new Date(`${date}T12:00:00Z`);

/** « octobre » / « أكتوبر » pour un jour civil. */
export function monthName(date: string, locale: string): string {
  return nameFormatter(locale, { month: 'long' }).format(atNoonUtc(date));
}

/** « lun. » / « الاثنين » */
export function weekdayName(
  date: string,
  locale: string,
  width: 'short' | 'long' = 'short',
): string {
  return nameFormatter(locale, { weekday: width }).format(atNoonUtc(date));
}

/** « samedi 24/10/2026 » */
export function formatLongDate(date: string, locale: string): string {
  return `${weekdayName(date, locale, 'long')} ${formatLocalDate(date)}`;
}
