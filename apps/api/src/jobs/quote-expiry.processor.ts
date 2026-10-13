import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QuotesService } from '../quotes/quotes.service';
import { reportJobFailure } from '../observability/sentry-exception.filter';

export const QUOTES_QUEUE = 'quotes';
const EXPIRY_SCHEDULER_ID = 'quotes-expiry';
const EVERY_HOUR_MS = 60 * 60 * 1000;

/**
 * Tâche planifiée (BullMQ, toutes les heures) : devis envoyés arrivés au terme de leur
 * validité → « Expiré » (la lecture d'un devis applique aussi la règle, sans attendre).
 */
@Processor(QUOTES_QUEUE)
export class QuoteExpiryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(QuoteExpiryProcessor.name);

  constructor(
    private readonly quotes: QuotesService,
    @InjectQueue(QUOTES_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      EXPIRY_SCHEDULER_ID,
      { every: EVERY_HOUR_MS },
      { name: 'expire-quotes', opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
  }

  async process(): Promise<{ expired: number }> {
    const expired = await this.quotes.expireDue();
    if (expired > 0) this.logger.log(`Devis expirés : ${expired}`);
    return { expired };
  }

  /** Échec définitif (après les nouvelles tentatives) : envoyé à Sentry. */
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    reportJobFailure(QUOTES_QUEUE, job?.name ?? 'inconnue', error);
  }
}
