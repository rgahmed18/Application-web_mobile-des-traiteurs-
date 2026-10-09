import { z } from 'zod';

/**
 * Dates et heures dans le fuseau du traiteur (Africa/Casablanca par défaut, qui change d'heure
 * pendant le ramadan). La base stocke des instants UTC ; l'interface et les règles métier
 * (capacité par jour, « commandes du jour ») raisonnent en jours civils du traiteur.
 *
 * Jours civils : chaînes « AAAA-MM-JJ » ; heures : « HH:mm ». Aucun calcul ne dépend du fuseau
 * de la machine (serveur ou navigateur).
 */

export const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const localDateSchema = z
  .string()
  .regex(DATE_PATTERN, 'Date invalide (AAAA-MM-JJ)')
  .refine((value) => isValidLocalDate(value), 'Date invalide');
export const localTimeSchema = z.string().regex(TIME_PATTERN, 'Heure invalide (HH:mm)');

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  return { year, month, day };
}

export function isValidLocalDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  const { year, month, day } = parseLocalDate(date);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Décalage (ms) du fuseau à un instant donné : heure locale − UTC. */
function offsetAt(instant: Date, timeZone: string): number {
  const clock = wallClock(instant, timeZone);
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Instant UTC correspondant à une date et une heure locales du traiteur.
 * Une heure inexistante (passage à l'heure d'été) est décalée vers l'avant, comme les agendas.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Deux passes : le décalage peut différer de part et d'autre d'un changement d'heure.
  const first = naive - offsetAt(new Date(naive), timeZone);
  const second = naive - offsetAt(new Date(first), timeZone);
  return new Date(second);
}

export interface ZonedParts {
  /** Jour civil « AAAA-MM-JJ » */
  date: string;
  /** Heure « HH:mm » */
  time: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Date et heure locales du traiteur pour un instant UTC. */
export function utcToZoned(instant: Date, timeZone: string): ZonedParts {
  const clock = wallClock(instant, timeZone);
  return {
    date: `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`,
    time: `${pad(clock.hour)}:${pad(clock.minute)}`,
  };
}

/** Bornes UTC [début, fin) d'un jour civil du traiteur. */
export function zonedDayRange(date: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedToUtc(date, '00:00', timeZone),
    end: zonedToUtc(addDays(date, 1), '00:00', timeZone),
  };
}

/** Jour civil + n jours (n négatif accepté). */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseLocalDate(date);
  const next = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Nombre de jours entre deux jours civils (b − a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseLocalDate(a);
  const pb = parseLocalDate(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY_MS,
  );
}

/** Jour de la semaine ISO (1 = lundi … 7 = dimanche). */
export function isoWeekday(date: string): number {
  const { year, month, day } = parseLocalDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Lundi de la semaine d'un jour civil (semaine du lundi au dimanche, usage marocain). */
export function startOfWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Premier jour du mois d'un jour civil. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Premier jour du mois suivant. */
export function startOfNextMonth(date: string): string {
  const { year, month } = parseLocalDate(date);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
}

/** Jour civil courant du traiteur. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return utcToZoned(now, timeZone).date;
}

/** Durée en minutes entre deux instants. */
export function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
}
