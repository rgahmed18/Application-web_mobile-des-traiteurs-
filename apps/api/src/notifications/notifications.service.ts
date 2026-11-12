import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_PERMISSIONS,
  NOTIFICATION_TYPES,
  type NotificationData,
  notificationDataSchema,
  type NotificationFeed,
  type NotificationType,
} from '@traiteur/shared';
import type { Queue } from 'bullmq';

import { PermissionsService } from '../access/permissions.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATIONS_QUEUE } from '../queue/queue.module';

type Db = Prisma.TransactionClient;

/** Notifications affichées dans la cloche (les plus récentes). */
const FEED_SIZE = 30;

export interface NotificationInput {
  traiteurId: string;
  type: NotificationType;
  entityType: 'Membership' | 'Order' | 'Quote';
  entityId: string;
  data: Partial<NotificationData> & { clientName: string };
}

/** Tâche d'envoi d'une notification par ses canaux (worker). */
export interface NotificationJob {
  notificationId: string;
}

/**
 * Notifications du traiteur : enregistrées dans la transaction de l'événement (nouveau client,
 * demande en ligne, réponse à un devis), puis confiées à la file « notifications » pour les
 * canaux d'envoi (dans l'application aujourd'hui ; SMS et WhatsApp prévus). Chaque membre ne voit
 * que les types permis par ses droits ; la lecture est propre à chaque utilisateur.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<NotificationJob>,
  ) {}

  /** Enregistre la notification dans la transaction de l'événement ; retourne son identifiant. */
  async record(tx: Db, input: NotificationInput): Promise<string> {
    const row = await tx.notification.create({
      data: {
        traiteurId: input.traiteurId,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        data: notificationDataSchema.parse(input.data),
      },
      select: { id: true },
    });
    return row.id;
  }

  /** Après la transaction : envoi par les canaux (au mieux, jamais bloquant pour l'action). */
  async dispatch(notificationIds: readonly string[]): Promise<void> {
    for (const notificationId of notificationIds) {
      try {
        await this.queue.add('deliver', { notificationId });
      } catch (error) {
        // File indisponible : la notification reste visible dans la cloche
        this.logger.warn(`Notification ${notificationId} non mise en file : ${String(error)}`);
      }
    }
  }

  async feed(user: AuthenticatedUser): Promise<NotificationFeed> {
    const traiteurId = requireTraiteurId(user);
    const types = await this.visibleTypes(user, traiteurId);
    if (types.length === 0) return { items: [], unread: 0 };
    const where: Prisma.NotificationWhereInput = { traiteurId, type: { in: types } };
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: FEED_SIZE,
        include: { reads: { where: { userId: user.userId }, select: { readAt: true } } },
      }),
      this.prisma.notification.count({
        where: { ...where, reads: { none: { userId: user.userId } } },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        entityType: row.entityType as 'Membership' | 'Order' | 'Quote',
        entityId: row.entityId,
        data: notificationDataSchema.parse(row.data),
        createdAt: row.createdAt.toISOString(),
        read: row.reads.length > 0,
      })),
      unread,
    };
  }

  async markRead(user: AuthenticatedUser, id: string): Promise<NotificationFeed> {
    const traiteurId = requireTraiteurId(user);
    const types = await this.visibleTypes(user, traiteurId);
    const notification = await this.prisma.notification.findFirst({
      where: { id, traiteurId, type: { in: types } },
      select: { id: true },
    });
    if (!notification) throw appErrors.notFound('NOT_FOUND', 'Notification introuvable');
    await this.prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId: id, userId: user.userId } },
      update: {},
      create: { notificationId: id, userId: user.userId },
    });
    return this.feed(user);
  }

  async markAllRead(user: AuthenticatedUser): Promise<NotificationFeed> {
    const traiteurId = requireTraiteurId(user);
    const types = await this.visibleTypes(user, traiteurId);
    const unread = await this.prisma.notification.findMany({
      where: { traiteurId, type: { in: types }, reads: { none: { userId: user.userId } } },
      select: { id: true },
    });
    await this.prisma.notificationRead.createMany({
      data: unread.map((row) => ({ notificationId: row.id, userId: user.userId })),
      skipDuplicates: true,
    });
    return this.feed(user);
  }

  /** Types visibles : ceux dont l'utilisateur a la permission (tous pour le super admin). */
  private async visibleTypes(
    user: AuthenticatedUser,
    traiteurId: string,
  ): Promise<NotificationType[]> {
    if (user.isSuperAdmin) return [...NOTIFICATION_TYPES];
    if (user.role === 'CLIENT') return [];
    const granted = await this.permissions.getEffectivePermissions(traiteurId, user.role);
    return NOTIFICATION_TYPES.filter((type) => granted.has(NOTIFICATION_PERMISSIONS[type]));
  }
}
