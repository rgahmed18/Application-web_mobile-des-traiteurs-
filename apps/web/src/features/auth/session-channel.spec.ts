import { afterEach, describe, expect, it } from 'vitest';

import { openSessionChannel, parseSessionMessage, type SessionMessage } from './session-channel';

describe('parseSessionMessage', () => {
  it('accepte les messages connus', () => {
    expect(parseSessionMessage({ type: 'ended', cause: 'logout' })).toEqual({
      type: 'ended',
      cause: 'logout',
    });
    expect(parseSessionMessage({ type: 'started' })).toEqual({ type: 'started' });
    expect(parseSessionMessage({ type: 'changed', extra: 1 })).toEqual({ type: 'changed' });
  });

  it('ignore tout le reste', () => {
    for (const data of [
      null,
      'ended',
      {},
      { type: 'ended' },
      { type: 'ended', cause: 'x' },
      { type: 'x' },
    ]) {
      expect(parseSessionMessage(data)).toBeNull();
    }
  });
});

describe('openSessionChannel : deux onglets', () => {
  const opened: { close(): void }[] = [];
  afterEach(() => {
    for (const channel of opened.splice(0)) channel.close();
  });

  it('la fin de session dans un onglet est reçue par l’autre', async () => {
    const received: SessionMessage[] = [];
    const tabA = openSessionChannel(() => undefined);
    const tabB = openSessionChannel((message) => received.push(message));
    opened.push(tabA, tabB);

    tabA.post({ type: 'ended', cause: 'logout' });
    await expect.poll(() => received).toEqual([{ type: 'ended', cause: 'logout' }]);
  });
});
