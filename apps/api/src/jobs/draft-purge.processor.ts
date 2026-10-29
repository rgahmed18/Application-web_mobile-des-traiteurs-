import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { DraftsService } from '../drafts/drafts.service';
import { reportJobFailure } from '../observability/sentry-exception.filter';

export const DRAFTS_QUEUE = 'drafts';
const PURGE_SCHEDULER_ID = 'drafts-purge';
const EVERY_HOUR_MS = 60 * 60 * 1000;

/**
 * Tâche planifiée (BullMQ, toutes les heures) : brouillons de plus de 30 jours, et brouillons
 * d'un accès du super admin terminé, supprimés. Seul le nombre est journalisé, jamais le contenu.
 */
@Processor(DRAFTS_QUEUE)
export class DraftPurgeProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DraftPurgeProcessor.name);

  constructor(
    private readonly drafts: DraftsService,
    @InjectQueue(DRAFTS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      PURGE_SCHEDULER_ID,
      { every: EVERY_HOUR_MS },
      { name: 'purge-drafts', opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
  }

  async process(): Promise<{ purged: number }> {
    const purged = await this.drafts.purge();
    if (purged > 0) this.logger.log(`Brouillons supprimés : ${purged}`);
    return { purged };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    reportJobFailure(DRAFTS_QUEUE, job?.name ?? 'inconnue', error);
  }
}
