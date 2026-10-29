/**
 * Logique d'enregistrement d'un brouillon, sans React (testée seule) :
 *   - enregistrement DELAY ms après la DERNIÈRE modification (pas une requête par frappe) ;
 *   - en cas d'échec (réseau coupé) : état « failed », nouvel essai après 5 s, 10 s, 20 s, puis
 *     toutes les 30 s, jusqu'à la réussite ;
 *   - « flush » : enregistre tout de suite ce qui ne l'est pas (fin de session, départ) ;
 *   - « clear » : attend l'enregistrement en vol, puis supprime (jamais de brouillon recréé
 *     après la suppression).
 */
export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export const DRAFT_SAVE_DELAY_MS = 3_000;
export const DRAFT_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const;

export interface DraftSaverOptions {
  save: () => Promise<void>;
  remove: () => Promise<void>;
  onStatus: (status: DraftSaveStatus, savedAt: Date | null) => void;
  delayMs?: number;
}

export class DraftSaver {
  /** Brouillon existant tranché (repris, supprimé, ou aucun) : sinon rien n'est enregistré. */
  private ready = false;
  private changed = false;
  private clearing = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;

  constructor(private options: DraftSaverOptions) {}

  configure(actions: Pick<DraftSaverOptions, 'save' | 'remove'>): void {
    this.options = { ...this.options, ...actions };
  }

  /** Une saisie : enregistrement après le délai, repoussé à chaque nouvelle saisie. */
  touch(): void {
    this.changed = true;
    if (!this.ready || this.clearing) return;
    this.schedule(this.options.delayMs ?? DRAFT_SAVE_DELAY_MS);
  }

  /** `edited` : le formulaire a déjà été modifié (saisie faite avant l'abonnement aux saisies). */
  setReady(ready: boolean, edited = false): void {
    this.ready = ready;
    if (edited) this.changed = true;
    // Saisie faite pendant la vérification du brouillon existant : enregistrée maintenant
    if (this.hasUnsavedChanges) this.schedule(this.options.delayMs ?? DRAFT_SAVE_DELAY_MS);
  }

  get hasUnsavedChanges(): boolean {
    return this.changed && this.ready && !this.clearing;
  }

  /** Enregistre tout de suite ce qui ne l'est pas encore. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (!this.hasUnsavedChanges) return;
    this.changed = false;
    this.options.onStatus('saving', null);
    const request = this.options.save();
    this.inflight = request;
    try {
      await request;
      this.failures = 0;
      this.options.onStatus('saved', new Date());
    } catch {
      this.changed = true;
      this.options.onStatus('failed', null);
      const delays: readonly number[] = DRAFT_RETRY_DELAYS_MS;
      const delay = delays[Math.min(this.failures, delays.length - 1)] ?? 30_000;
      this.failures += 1;
      this.schedule(delay);
    } finally {
      if (this.inflight === request) this.inflight = null;
    }
  }

  /** Enregistré pour de bon : brouillon supprimé ; une nouvelle saisie en recrée un. */
  async clear(): Promise<void> {
    this.clearing = true;
    this.cancelTimer();
    this.changed = false;
    await this.inflight?.catch(() => undefined);
    await this.options.remove().catch(() => undefined);
    this.failures = 0;
    this.options.onStatus('idle', null);
    this.clearing = false;
  }

  /** Marque comme enregistré (envoi « keepalive » à la fermeture de la page). */
  markSaved(): void {
    this.cancelTimer();
    this.changed = false;
  }

  dispose(): void {
    this.cancelTimer();
  }

  private schedule(delay: number): void {
    this.cancelTimer();
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
