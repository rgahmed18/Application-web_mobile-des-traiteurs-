import { addDays, zonedToUtc } from '@traiteur/shared';

import { appErrors } from '../common/errors';

/**
 * Horaire d'un événement, tel que saisi : date civile « AAAA-MM-JJ » et heures « HH:mm » du
 * traiteur, sans fuseau. C'est la source de vérité, stockée telle quelle (colonnes `eventDay`,
 * `startTime`, `endTime`, `endsNextDay`) et relue telle quelle par le back-office, l'espace
 * client et les PDF : aucune conversion ne peut décaler le jour (fuseau du navigateur, base des
 * fuseaux mise à jour comme le Maroc à UTC+0 depuis 2026, heure proche de minuit).
 *
 * Les instants UTC (`eventDate`, `eventEndDate`) en sont dérivés pour les calculs de
 * chevauchement (matériel, planning) et recalculés à chaque écriture.
 */
export interface EventSchedule {
  eventDate: string;
  startTime: string;
  endTime: string | null;
  endsNextDay: boolean;
}

/** Colonnes civiles d'une commande (lecture). */
export interface CivilColumns {
  eventDay: Date;
  startTime: string;
  endTime: string | null;
  endsNextDay: boolean;
}

/** Jour civil → colonne DATE (minuit UTC, ce que Prisma attend pour `@db.Date`). */
export function dayColumn(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Colonne DATE → jour civil « AAAA-MM-JJ » (jamais via le fuseau de la machine). */
export function dayOf(column: Date): string {
  return column.toISOString().slice(0, 10);
}

/** Horaire relu depuis les colonnes civiles, sans aucune conversion de fuseau. */
export function civilSchedule(row: CivilColumns): EventSchedule {
  return {
    eventDate: dayOf(row.eventDay),
    startTime: row.startTime,
    endTime: row.endTime,
    endsNextDay: row.endTime !== null && row.endsNextDay,
  };
}

/** Instants UTC dérivés de l'horaire civil, dans le fuseau du traiteur. */
export function scheduleInstants(
  input: EventSchedule,
  timeZone: string,
): { eventDate: Date; eventEndDate: Date | null } {
  const eventDate = zonedToUtc(input.eventDate, input.startTime, timeZone);
  const eventEndDate =
    input.endTime === null
      ? null
      : zonedToUtc(
          input.endsNextDay ? addDays(input.eventDate, 1) : input.eventDate,
          input.endTime,
          timeZone,
        );
  if (eventEndDate && eventEndDate <= eventDate) {
    throw appErrors.badRequest('VALIDATION_ERROR', 'La fin doit être après le début');
  }
  return { eventDate, eventEndDate };
}

/** Champs à écrire sur la commande : horaire civil (vérité) et instants dérivés. */
export function scheduleData(input: EventSchedule, timeZone: string) {
  const endsNextDay = input.endTime !== null && input.endsNextDay;
  return {
    eventDay: dayColumn(input.eventDate),
    startTime: input.startTime,
    endTime: input.endTime,
    endsNextDay,
    ...scheduleInstants({ ...input, endsNextDay }, timeZone),
  };
}

/** Même horaire civil (jour, heures, fin le lendemain). */
export function sameSchedule(a: EventSchedule, b: EventSchedule): boolean {
  return (
    a.eventDate === b.eventDate &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    (a.endTime !== null && a.endsNextDay) === (b.endTime !== null && b.endsNextDay)
  );
}
