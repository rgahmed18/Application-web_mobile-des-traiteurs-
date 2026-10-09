import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler';

import type { DocumentModel } from './document-model';

/** Gabarits et polices (licence OFL) : apps/api/assets. */
export const ASSETS_DIR = join(__dirname, '..', '..', 'assets');
const FONTS_DIR = join(ASSETS_DIR, 'fonts');
const TEMPLATE = join(ASSETS_DIR, 'templates', 'document.typ');

/** Version du gabarit, enregistrée avec chaque document figé (reçu, devis envoyé, facture). */
export const DOCUMENT_TEMPLATE_VERSION = 'document@1';

export interface RenderedPdf {
  pdf: Buffer;
  sha256: string;
}

/**
 * Génération des PDF avec Typst (mise en forme arabe et bidirectionnelle, rendu déterministe :
 * mêmes données, même PDF octet pour octet). Le rendu est synchrone : les fichiers virtuels
 * (données, logo) ne peuvent pas se mélanger entre deux documents.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly compiler = NodeCompiler.create({
    workspace: ASSETS_DIR,
    fontArgs: [{ fontPaths: [FONTS_DIR] }],
  });
  private readonly template = readFileSync(TEMPLATE, 'utf8');

  render(model: DocumentModel, logo: Buffer | null = null): RenderedPdf {
    const started = performance.now();
    this.compiler.resetShadow();
    this.compiler.mapShadow(
      join(ASSETS_DIR, 'data.json'),
      Buffer.from(JSON.stringify(model), 'utf8'),
    );
    if (logo) this.compiler.mapShadow(join(ASSETS_DIR, 'logo.png'), logo);
    try {
      const pdf = this.compiler.pdf({ mainFileContent: this.template });
      this.logger.debug(`${model.number} rendu en ${Math.round(performance.now() - started)} ms`);
      return { pdf, sha256: createHash('sha256').update(pdf).digest('hex') };
    } finally {
      this.compiler.resetShadow();
      // Libère la mémoire des rendus précédents (cache incrémental de Typst)
      this.compiler.evictCache(10);
    }
  }
}
