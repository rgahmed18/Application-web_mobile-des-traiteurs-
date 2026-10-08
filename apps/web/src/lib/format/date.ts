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
