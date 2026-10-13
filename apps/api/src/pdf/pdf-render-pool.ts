import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { RenderReply, RenderRequest, RenderWorkerSetup } from './pdf-render.worker';

export interface RenderedPdf {
  pdf: Buffer;
  sha256: string;
}

export interface PdfRenderPoolOptions extends RenderWorkerSetup {
  /** Nombre maximal de threads de rendu. */
  size: number;
  /** Délai maximal de rendu d'un document (le thread est alors arrêté et remplacé). */
  timeoutMs: number;
  log: (message: string) => void;
}

/** Rendu trop long : le thread a été arrêté (document probablement anormal). */
export class PdfRenderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Rendu PDF interrompu après ${timeoutMs} ms`);
    this.name = 'PdfRenderTimeoutError';
  }
}

interface Task {
  id: number;
  request: RenderRequest;
  resolve: (result: RenderedPdf) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  task: Task | null;
  timer: NodeJS.Timeout | null;
}

/**
 * Script du thread : le JavaScript compilé (API et worker en production) ou, à défaut, la source
 * TypeScript chargée par tsx (tests d'intégration exécutés depuis src).
 */
function workerScript(): { file: string; execArgv: string[] } {
  const compiled = join(__dirname, 'pdf-render.worker.js');
  if (existsSync(compiled)) return { file: compiled, execArgv: [] };
  return { file: join(__dirname, 'pdf-render.worker.ts'), execArgv: ['--import', 'tsx'] };
}

/**
 * Pool de threads de rendu Typst. Les threads sont lancés à la demande (au plus `size`), les
 * documents en attente sont servis dans l'ordre d'arrivée. Un rendu qui dépasse `timeoutMs` ou
 * un thread qui plante est rejeté, et le thread est remplacé : le pool reste toujours utilisable.
 */
export class PdfRenderPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Task[] = [];
  private readonly script = workerScript();
  private nextId = 1;
  private closed = false;

  constructor(private readonly options: PdfRenderPoolOptions) {}

  render(model: unknown, logo: Buffer | null): Promise<RenderedPdf> {
    if (this.closed) return Promise.reject(new Error('Pool de rendu PDF arrêté'));
    return new Promise<RenderedPdf>((resolve, reject) => {
      const id = this.nextId++;
      this.queue.push({
        id,
        request: { id, data: JSON.stringify(model), logo: logo ? new Uint8Array(logo) : null },
        resolve,
        reject,
      });
      this.dispatch();
    });
  }

  /** Documents en cours de rendu et en attente (diagnostic, tests). */
  stats(): { threads: number; busy: number; queued: number } {
    return {
      threads: this.slots.length,
      busy: this.slots.filter((slot) => slot.task).length,
      queued: this.queue.length,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const task of this.queue.splice(0)) task.reject(new Error('Pool de rendu PDF arrêté'));
    await Promise.all(
      this.slots.splice(0).map(async (slot) => {
        if (slot.timer) clearTimeout(slot.timer);
        slot.task?.reject(new Error('Pool de rendu PDF arrêté'));
        await slot.worker.terminate();
      }),
    );
  }

  // ─────────────────────────── Interne ───────────────────────────

  private dispatch(): void {
    while (this.queue.length > 0) {
      let slot = this.slots.find((candidate) => candidate.task === null);
      if (!slot && this.slots.length < this.options.size) slot = this.spawn();
      if (!slot) return;
      const task = this.queue.shift();
      if (!task) return;
      this.start(slot, task);
    }
  }

  private spawn(): Slot {
    const worker = new Worker(this.script.file, {
      execArgv: this.script.execArgv,
      workerData: {
        assetsDir: this.options.assetsDir,
        template: this.options.template,
      } satisfies RenderWorkerSetup,
    });
    const slot: Slot = { worker, task: null, timer: null };
    worker.on('message', (reply: RenderReply) => this.finish(slot, reply));
    worker.on('error', (error: Error) => this.replace(slot, error));
    worker.on('exit', (code) => {
      if (!this.closed && this.slots.includes(slot)) {
        this.replace(slot, new Error(`Thread de rendu arrêté (code ${code})`));
      }
    });
    // Un thread inactif ne retient pas la fin du processus
    worker.unref();
    this.slots.push(slot);
    return slot;
  }

  private start(slot: Slot, task: Task): void {
    slot.task = task;
    slot.worker.ref();
    slot.timer = setTimeout(() => {
      this.options.log(`Rendu PDF trop long (> ${this.options.timeoutMs} ms) : thread remplacé`);
      this.replace(slot, new PdfRenderTimeoutError(this.options.timeoutMs));
    }, this.options.timeoutMs);
    slot.worker.postMessage(task.request);
  }

  private finish(slot: Slot, reply: RenderReply): void {
    const task = slot.task;
    if (!task || task.id !== reply.id) return;
    this.release(slot);
    if (reply.ok) {
      task.resolve({ pdf: Buffer.from(reply.pdf), sha256: reply.sha256 });
    } else {
      task.reject(new Error(reply.error));
    }
    this.dispatch();
  }

  private release(slot: Slot): void {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.task = null;
    slot.worker.unref();
  }

  /** Rendu en échec (délai, plantage) : rejet du document, thread arrêté et retiré du pool. */
  private replace(slot: Slot, error: Error): void {
    const index = this.slots.indexOf(slot);
    if (index === -1) return;
    this.slots.splice(index, 1);
    const task = slot.task;
    this.release(slot);
    void slot.worker.terminate();
    task?.reject(error);
    if (!this.closed) this.dispatch();
  }
}
