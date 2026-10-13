/**
 * Thread de rendu Typst (worker_threads), piloté par PdfRenderPool. Chaque thread a son propre
 * compilateur (polices chargées une fois) et rend un document à la fois : le rendu, synchrone,
 * ne bloque jamais la boucle d'événements de l'API.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler';

export interface RenderWorkerSetup {
  assetsDir: string;
  template: string;
}

export interface RenderRequest {
  id: number;
  /** Modèle du document, sérialisé en JSON. */
  data: string;
  logo: Uint8Array | null;
}

export type RenderReply =
  | { id: number; ok: true; pdf: Uint8Array; sha256: string; ms: number }
  | { id: number; ok: false; error: string };

const setup = workerData as RenderWorkerSetup;
const compiler = NodeCompiler.create({
  workspace: setup.assetsDir,
  fontArgs: [{ fontPaths: [join(setup.assetsDir, 'fonts')] }],
});

parentPort?.on('message', (request: RenderRequest) => {
  const started = performance.now();
  let reply: RenderReply;
  try {
    compiler.resetShadow();
    compiler.mapShadow(join(setup.assetsDir, 'data.json'), Buffer.from(request.data, 'utf8'));
    if (request.logo) {
      compiler.mapShadow(join(setup.assetsDir, 'logo.png'), Buffer.from(request.logo));
    }
    const pdf = compiler.pdf({ mainFileContent: setup.template });
    reply = {
      id: request.id,
      ok: true,
      pdf,
      sha256: createHash('sha256').update(pdf).digest('hex'),
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    reply = { id: request.id, ok: false, error: String(error) };
  } finally {
    compiler.resetShadow();
    compiler.evictCache(10);
  }
  parentPort?.postMessage(reply);
});
