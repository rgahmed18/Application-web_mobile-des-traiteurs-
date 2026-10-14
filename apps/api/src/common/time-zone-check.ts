import { Logger } from '@nestjs/common';
import { hasCurrentMoroccoTimeZoneData } from '@traiteur/shared';

/**
 * Base des fuseaux horaires (tzdata) de Node : le Maroc est à UTC+0 depuis le 20 septembre 2026
 * (IANA 2026c). Une base plus ancienne décale d'une heure les événements, échéances et
 * documents : en production, l'API et le worker refusent de démarrer ; en développement, un
 * avertissement suffit.
 */
export function assertTimeZoneData(
  current: boolean = hasCurrentMoroccoTimeZoneData(),
  environment: string | undefined = process.env.NODE_ENV,
): void {
  if (current) return;
  const message =
    `Base des fuseaux horaires obsolète (tzdata ${process.versions.tz ?? 'inconnue'}) : ` +
    'Casablanca serait décalé d’une heure. Mettez Node à jour (24.21 ou plus récent).';
  if (environment === 'production') throw new Error(message);
  Logger.warn(message, 'Fuseaux horaires');
}
