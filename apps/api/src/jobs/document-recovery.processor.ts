import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import {
  DocumentRecoveryService,
  type RecoveryReport,
} from '../document-recovery/document-recovery.service';
import { reportJobFailure } from '../observability/sentry-exception.filter';

export const DOCUMENTS_QUEUE = 'documents';
const RECOVERY_SCHEDULER_ID = 'documents-recovery';
const EVERY_FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Tâche planifiée (BullMQ, toutes les 5 minutes, une seule exécution à la fois même avec
 * plusieurs instances de l'API) : régénère les PDF figés manquants. Voir DocumentRecoveryService.
 */
@Processor(DOCUMENTS_QUEUE, { concurrency: 1 })
export class DocumentRecoveryProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly recovery: DocumentRecoveryService,
    @InjectQueue(DOCUMENTS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RECOVERY_SCHEDULER_ID,
      { every: EVERY_FIVE_MINUTES_MS },
      { name: 'recover-pdfs', opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
  }

  process(): Promise<RecoveryReport> {
    return this.recovery.recover();
  }

  /** Échec définitif (après les nouvelles tentatives) : envoyé à Sentry. */
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    reportJobFailure(DOCUMENTS_QUEUE, job?.name ?? 'inconnue', error);
  }
}
