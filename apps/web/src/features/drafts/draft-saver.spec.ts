import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftSaver, type DraftSaveStatus } from './draft-saver';

function setup(save: () => Promise<void> = () => Promise.resolve()) {
  const statuses: DraftSaveStatus[] = [];
  const saveSpy = vi.fn(save);
  const removeSpy = vi.fn(() => Promise.resolve());
  const saver = new DraftSaver({
    save: saveSpy,
    remove: removeSpy,
    onStatus: (status) => statuses.push(status),
  });
  saver.setReady(true);
  return { saver, saveSpy, removeSpy, statuses };
}

describe('DraftSaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('une seule requête 3 s après la dernière frappe, jamais une par frappe', async () => {
    const { saver, saveSpy, statuses } = setup();
    for (let i = 0; i < 10; i += 1) {
      saver.touch();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(saveSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['saving', 'saved']);
  });

  it('rien avant que le brouillon existant soit tranché (reprendre ou supprimer)', async () => {
    const { saver, saveSpy } = setup();
    saver.setReady(false);
    saver.touch();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('saisie faite avant la fin de la vérification : enregistrée dès qu’elle se termine', async () => {
    const { saver, saveSpy } = setup();
    saver.setReady(false);
    saver.touch();
    saver.setReady(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('formulaire déjà modifié à la fin de la vérification : enregistré aussi', async () => {
    const { saver, saveSpy } = setup();
    saver.setReady(false);
    saver.setReady(true, true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('réseau coupé : « non enregistré », puis nouveaux essais automatiques jusqu’à la réussite', async () => {
    let online = false;
    const { saver, saveSpy, statuses } = setup(() =>
      online ? Promise.resolve() : Promise.reject(new Error('réseau')),
    );
    saver.touch();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(statuses.at(-1)).toBe('failed');
    await vi.advanceTimersByTimeAsync(5_000); // 1er nouvel essai
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('failed');
    online = true;
    await vi.advanceTimersByTimeAsync(10_000); // 2e nouvel essai
    expect(saveSpy).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe('saved');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(saveSpy).toHaveBeenCalledTimes(3);
  });

  it('fin de session : enregistrement immédiat de ce qui ne l’est pas', async () => {
    const { saver, saveSpy } = setup();
    saver.touch();
    await saver.flush();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    await saver.flush(); // rien de nouveau
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('enregistrement réel : attend l’envoi en vol puis supprime ; pas de brouillon recréé', async () => {
    let finish: () => void = () => undefined;
    const { saver, saveSpy, removeSpy } = setup(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    saver.touch();
    const saving = saver.flush();
    const clearing = saver.clear();
    expect(removeSpy).not.toHaveBeenCalled();
    finish();
    await saving;
    await clearing;
    expect(removeSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    // Une nouvelle saisie (paramètres restés affichés) recrée un brouillon
    saver.touch();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(saveSpy).toHaveBeenCalledTimes(2);
  });
});
