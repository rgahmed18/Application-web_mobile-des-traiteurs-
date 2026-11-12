import type { NotificationChannelKey } from '@traiteur/shared';

import type { Notification } from '../generated/prisma/client';

/**
 * Canal d'envoi d'une notification du traiteur. Aujourd'hui seul « dans l'application » (la
 * cloche lit la base) ; un canal SMS ou WhatsApp s'ajoute ici, avec les préférences de chaque
 * membre (types et canaux choisis), sans changer les événements qui notifient.
 */
export interface NotificationChannel {
  readonly key: NotificationChannelKey;
  deliver(notification: Notification): Promise<void>;
}

/** La cloche du back-office : la notification est déjà enregistrée, rien à envoyer. */
export class InAppChannel implements NotificationChannel {
  readonly key = 'IN_APP' as const;

  deliver(): Promise<void> {
    return Promise.resolve();
  }
}
