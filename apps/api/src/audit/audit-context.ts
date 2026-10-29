import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexte d'une requête du super admin entré chez un traiteur : AuditService y note qu'un
 * événement métier a été tracé (ex. « Paramètres de l'entreprise modifiés »). L'intercepteur
 * n'ajoute alors pas de ligne « requête de la plateforme » : une action = une seule ligne.
 */
export interface AuditRequestContext {
  businessEventRecorded: boolean;
}

export const auditRequestContext = new AsyncLocalStorage<AuditRequestContext>();
