import { Injectable, Logger } from '@nestjs/common';

import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotesService } from '../quotes/quotes.service';

/** Laisse le temps à la génération faite juste après le commit avant de la reprendre. */
export const RECOVERY_GRACE_MS = 2 * 60 * 1000;
/** Documents repris par passage et par type (les suivants attendent le passage d'après). */
const BATCH = 25;

export interface RecoveryReport {
  invoices: number;
  receipts: number;
  quotes: number;
  failed: number;
}

/**
 * Reprise automatique des PDF figés qui manquent : factures et avoirs, reçus, devis envoyés.
 *
 * Règle commune : un document est d'abord enregistré en base (transaction courte, aucune
 * opération lente sous verrou), puis son PDF est rendu (Typst) et envoyé au stockage APRÈS le
 * commit. Si cette seconde étape échoue (stockage indisponible, redémarrage…), le document
 * reste valide sans PDF : il est produit au premier téléchargement et, à défaut, ici. Le rendu
 * est déterministe et l'enregistrement de la clé ne se fait qu'une fois (`pdfKey` vide dans la
 * condition) : une reprise concurrente d'un téléchargement donne le même fichier.
 */
@Injectable()
export class DocumentRecoveryService {
  private readonly logger = new Logger(DocumentRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly quotes: QuotesService,
  ) {}

  async recover(now = new Date()): Promise<RecoveryReport> {
    const before = new Date(now.getTime() - RECOVERY_GRACE_MS);
    const [invoices, receipts, quotes] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { pdfKey: null, createdAt: { lt: before } },
        select: { id: true, traiteurId: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      }),
      this.prisma.payment.findMany({
        where: {
          receiptNumber: { not: null },
          receiptPdfKey: null,
          voidedAt: null,
          updatedAt: { lt: before },
        },
        select: { id: true, traiteurId: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      }),
      this.prisma.quote.findMany({
        where: { sentAt: { not: null, lt: before }, pdfKey: null },
        select: { id: true, traiteurId: true },
        orderBy: { sentAt: 'asc' },
        take: BATCH,
      }),
    ]);

    const report: RecoveryReport = { invoices: 0, receipts: 0, quotes: 0, failed: 0 };
    // Un document à la fois : le rendu Typst est synchrone (pas de rafale qui bloque l'API)
    const run = async (
      kind: keyof Omit<RecoveryReport, 'failed'>,
      id: string,
      job: () => Promise<unknown>,
    ) => {
      try {
        await job();
        report[kind] += 1;
      } catch (error) {
        report.failed += 1;
        this.logger.warn(`Reprise du PDF (${kind}) ${id} en échec : ${String(error)}`);
      }
    };
    for (const row of invoices) {
      await run('invoices', row.id, () => this.invoices.ensurePdf(row.traiteurId, row.id));
    }
    for (const row of receipts) {
      await run('receipts', row.id, () => this.payments.storeReceipt(row.traiteurId, row.id));
    }
    for (const row of quotes) {
      await run('quotes', row.id, () => this.quotes.storeSentPdf(row.traiteurId, row.id));
    }
    if (report.invoices + report.receipts + report.quotes + report.failed > 0) {
      this.logger.log(
        `PDF repris : ${report.invoices} facture(s), ${report.receipts} reçu(s), ` +
          `${report.quotes} devis ; ${report.failed} échec(s)`,
      );
    }
    return report;
  }
}
