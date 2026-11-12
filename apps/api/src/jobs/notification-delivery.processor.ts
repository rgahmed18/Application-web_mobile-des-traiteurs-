import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { InAppChannel, type NotificationChannel } from '../notifications/notification-channels';
import type { NotificationJob } from '../notifications/notifications.service';
import { reportJobFailure } from '../observability/sentry-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATIONS_QUEUE } from '../queue/queue.module';

/**
 * Envoi d'une notification du traiteur par ses canaux (worker). Seul le canal « dans
 * l'application » existe : les canaux SMS et WhatsApp s'ajouteront à cette liste.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationDeliveryProcessor.name);
  private readonly channels: readonly NotificationChannel[] = [new InAppChannel()];

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<{ channels: string[] }> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: job.data.notificationId },
    });
    if (!notification) return { channels: [] };
    for (const channel of this.channels) await channel.deliver(notification);
    return { channels: this.channels.map((channel) => channel.key) };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.warn(`Notification non envoyée : ${error.message}`);
    reportJobFailure(NOTIFICATIONS_QUEUE, job?.name ?? 'inconnue', error);
  }
}
