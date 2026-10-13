import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfigService } from '../config/app-config.module';
import type { DocumentModel } from './document-model';
import { PdfRenderPool, PdfRenderTimeoutError, type RenderedPdf } from './pdf-render-pool';

/** Gabarits et polices (licence OFL) : apps/api/assets. */
export const ASSETS_DIR = join(__dirname, '..', '..', 'assets');
const TEMPLATE = join(ASSETS_DIR, 'templates', 'document.typ');

/** Version du gabarit, enregistrée avec chaque document figé (reçu, devis envoyé, facture). */
export const DOCUMENT_TEMPLATE_VERSION = 'document@1';

export type { RenderedPdf };

/**
 * Génération des PDF avec Typst (mise en forme arabe et bidirectionnelle, rendu déterministe :
 * mêmes données, même PDF octet pour octet). Le rendu, synchrone dans Typst, se fait dans un
 * pool de threads (PDF_WORKERS) avec un délai maximal par document (PDF_RENDER_TIMEOUT_MS) :
 * l'API reste réactive pendant qu'un lot de documents est généré.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private readonly pool: PdfRenderPool;

  constructor(@Inject(ConfigService) config: AppConfigService) {
    this.pool = new PdfRenderPool({
      assetsDir: ASSETS_DIR,
      template: readFileSync(TEMPLATE, 'utf8'),
      size: config.get('PDF_WORKERS', { infer: true }),
      timeoutMs: config.get('PDF_RENDER_TIMEOUT_MS', { infer: true }),
      log: (message) => this.logger.warn(message),
    });
  }

  async render(model: DocumentModel, logo: Buffer | null = null): Promise<RenderedPdf> {
    try {
      return await this.pool.render(model, logo);
    } catch (error) {
      if (error instanceof PdfRenderTimeoutError) {
        throw new ServiceUnavailableException({
          code: 'PDF_TIMEOUT',
          message: 'La génération du document a pris trop de temps, réessayez',
        });
      }
      throw error;
    }
  }

  /** Threads, rendus en cours et en attente (diagnostic, tests). */
  stats(): ReturnType<PdfRenderPool['stats']> {
    return this.pool.stats();
  }

  onModuleDestroy(): Promise<void> {
    return this.pool.close();
  }
}
