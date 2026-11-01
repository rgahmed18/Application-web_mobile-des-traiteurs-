import { describe, expect, it } from 'vitest';

import { readSessionMark, wakeAction, WAKE_VERIFY_AFTER_MS } from './session-wake';

const awake = {
  authenticated: true,
  sessionMark: 'abc',
  currentMark: 'abc',
  hiddenForMs: 1_000,
  restoredFromCache: false,
};

describe('réveil d’un onglet', () => {
  it('lit le repère parmi les cookies', () => {
    expect(readSessionMark('a=1; gt_session_mark=xYz-9; b=2')).toBe('xYz-9');
    expect(readSessionMark('a=1')).toBeNull();
    expect(readSessionMark('gt_session_mark=')).toBeNull();
  });

  it('déconnexion ailleurs (repère effacé) ou nouvelle session (repère remplacé) : terminée', () => {
    expect(wakeAction({ ...awake, currentMark: null })).toBe('ended');
    expect(wakeAction({ ...awake, currentMark: 'autre' })).toBe('ended');
  });

  it('longue absence ou page restaurée du cache : vérification auprès du serveur', () => {
    expect(wakeAction({ ...awake, hiddenForMs: WAKE_VERIFY_AFTER_MS })).toBe('verify');
    expect(wakeAction({ ...awake, restoredFromCache: true })).toBe('verify');
  });

  it('court changement d’onglet, sans session ou repère inconnu : rien', () => {
    expect(wakeAction(awake)).toBe('none');
    expect(wakeAction({ ...awake, authenticated: false, currentMark: null })).toBe('none');
    expect(wakeAction({ ...awake, sessionMark: null, currentMark: null })).toBe('none');
  });
});
