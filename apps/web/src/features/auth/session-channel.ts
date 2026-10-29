/**
 * Messages entre les onglets ouverts sur la même adresse (donc le même espace : un traiteur, ou
 * la console) : la fin de session dans un onglet termine aussitôt celle des autres.
 * BroadcastChannel ne relie que les onglets de la même origine : la déconnexion chez Dar Diafa ne
 * touche ni la console ni un autre traiteur.
 */
export type SessionEndCause = 'logout' | 'expired' | 'suspended';

export type SessionMessage =
  /** Session terminée dans un autre onglet : enregistrer les brouillons, puis la fermer ici. */
  | { type: 'ended'; cause: SessionEndCause }
  /** Session ouverte dans un autre onglet : un onglet sans session la reprend (cookie). */
  | { type: 'started' }
  /** Espace changé (super admin entré chez un traiteur ou revenu à la console) : recharger. */
  | { type: 'changed' };

const CHANNEL_NAME = 'gt-session';
const TYPES = new Set(['ended', 'started', 'changed']);
const CAUSES = new Set(['logout', 'expired', 'suspended']);

/** Message reçu d'un autre onglet, vérifié (jamais de confiance aveugle dans son contenu). */
export function parseSessionMessage(data: unknown): SessionMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, cause } = data as { type?: unknown; cause?: unknown };
  if (typeof type !== 'string' || !TYPES.has(type)) return null;
  if (type === 'ended') {
    return typeof cause === 'string' && CAUSES.has(cause)
      ? { type, cause: cause as SessionEndCause }
      : null;
  }
  return { type: type as 'started' | 'changed' };
}

export interface SessionChannel {
  post(message: SessionMessage): void;
  close(): void;
}

/** Canal des onglets ; inactif si le navigateur ne connaît pas BroadcastChannel. */
export function openSessionChannel(onMessage: (message: SessionMessage) => void): SessionChannel {
  if (typeof BroadcastChannel === 'undefined')
    return { post: () => undefined, close: () => undefined };
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent) => {
    const message = parseSessionMessage(event.data);
    if (message) onMessage(message);
  };
  return {
    post: (message) => channel.postMessage(message),
    close: () => channel.close(),
  };
}
