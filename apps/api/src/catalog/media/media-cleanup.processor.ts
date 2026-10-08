import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { MediaService } from './media.service';

export const MEDIA_QUEUE = 'media';
const CLEANUP_SCHEDULER_ID = 'media-orphans-cleanup';
const EVERY_HOUR_MS = 60 * 60 * 1000;

/**
 * Tâche planifiée (BullMQ, toutes les heures) : supprime du stockage les photos jamais
 * rattachées à un élément, ou remplacées, depuis plus de 24 h.
 * Le planificateur est partagé entre les instances de l'API : une seule exécution par heure.
 */
@Processor(MEDIA_QUEUE)
export class MediaCleanupProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MediaCleanupProcessor.name);

  constructor(
    private readonly media: MediaService,
    @InjectQueue(MEDIA_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      CLEANUP_SCHEDULER_ID,
      { every: EVERY_HOUR_MS },
      { name: 'cleanup-orphans', opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
  }

  async process(): Promise<{ removed: number }> {
    const removed = await this.media.cleanupOrphans();
    this.logger.log(`Nettoyage des photos orphelines : ${removed} supprimée(s)`);
    return { removed };
  }
}
