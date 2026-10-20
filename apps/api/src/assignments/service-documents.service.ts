import { Injectable, Logger } from '@nestjs/common';
import { type Download, FIRM_ORDER_STATUSES, utcToZoned, zonedDayRange } from '@traiteur/shared';

import { readLineLabel } from '../documents/line-label';
import { appErrors } from '../common/errors';
import { toLocalized } from '../catalog/catalog-common';
import { toSchedule } from '../orders/order-mapper';
import type { DocLocale } from '../pdf/format';
import { PdfService } from '../pdf/pdf.service';
import { type Seller, sellerSelect } from '../pdf/seller';
import { PrismaService } from '../prisma/prisma.service';
import { PRIVATE_PREFIX, StorageService } from '../storage/storage.service';
import { deliveryNoteDocument } from './delivery-note';
import {
  type PrepOrder,
  preparationDocument,
  preparationItems,
  preparationItemsInclude,
} from './preparation-sheet';

const orderSelect = {
  id: true,
  reference: true,
  eventType: true,
  eventTypeRef: { select: { name: true } },
  eventDate: true,
  eventEndDate: true,
  guestCount: true,
  venueName: true,
  venueAddress: true,
  city: true,
  notes: true,
  serviceNotes: true,
  equipment: true,
  onSiteContactName: true,
  onSiteContactPhone: true,
  client: {
    select: { firstName: true, lastName: true, locale: true, user: { select: { phone: true } } },
  },
  ...preparationItemsInclude,
} as const;

/**
 * Bons de préparation (cuisine) et de livraison, sans aucun prix. Générés à la demande (ce ne
 * sont pas des documents fiscaux), stockés en privé et servis par URL signée (5 minutes).
 */
@Injectable()
export class ServiceDocumentsService {
  private readonly logger = new Logger(ServiceDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
  ) {}

  /** Bon de préparation d'un événement. */
  async orderPreparation(
    traiteurId: string,
    orderId: string,
    locale: DocLocale,
  ): Promise<Download> {
    const order = await this.order(traiteurId, orderId);
    const seller = await this.seller(traiteurId);
    const day = utcToZoned(order.eventDate, seller.timezone).date;
    return this.publish(
      traiteurId,
      `${order.reference}-preparation-${locale}`,
      `${order.reference}-preparation.pdf`,
      seller,
      (hasLogo) =>
        preparationDocument({
          locale,
          seller,
          hasLogo,
          scope: 'event',
          day,
          orders: [this.prepOrder(order, seller.timezone)],
        }),
    );
  }

  /** Bon de préparation du jour : toutes les commandes fermes de la journée. */
  async dayPreparation(traiteurId: string, day: string, locale: DocLocale): Promise<Download> {
    const seller = await this.seller(traiteurId);
    const { start, end } = zonedDayRange(day, seller.timezone);
    const orders = await this.prisma.order.findMany({
      where: {
        traiteurId,
        eventDate: { gte: start, lt: end },
        status: { in: [...FIRM_ORDER_STATUSES] },
      },
      select: orderSelect,
      orderBy: { eventDate: 'asc' },
    });
    return this.publish(
      traiteurId,
      `preparation-${day}-${locale}`,
      `preparation-${day}.pdf`,
      seller,
      (hasLogo) =>
        preparationDocument({
          locale,
          seller,
          hasLogo,
          scope: 'day',
          day,
          orders: orders.map((order) => this.prepOrder(order, seller.timezone)),
        }),
    );
  }

  /** Bon de livraison, dans la langue du client (c'est lui qui signe). */
  async deliveryNote(
    traiteurId: string,
    orderId: string,
    deliveryAt: Date | null,
  ): Promise<Download> {
    const order = await this.order(traiteurId, orderId);
    const seller = await this.seller(traiteurId);
    const schedule = toSchedule(order, seller.timezone);
    const locale: DocLocale = order.client.locale === 'ar' ? 'ar' : 'fr';
    const clientName = `${order.client.firstName} ${order.client.lastName}`.trim();
    return this.publish(
      traiteurId,
      `${order.reference}-livraison`,
      `${order.reference}-livraison.pdf`,
      seller,
      (hasLogo) =>
        deliveryNoteDocument({
          locale,
          seller,
          hasLogo,
          reference: order.reference,
          eventTypeName: toLocalized(order.eventTypeRef.name),
          date: schedule.eventDate,
          startTime: schedule.startTime,
          deliveryTime: deliveryAt
            ? utcToZoned(deliveryAt, seller.timezone).time
            : schedule.startTime,
          guestCount: order.guestCount,
          venue: { name: order.venueName, address: order.venueAddress, city: order.city },
          contact: {
            name: order.onSiteContactName ?? clientName,
            phone: order.onSiteContactPhone ?? order.client.user.phone,
          },
          lines: order.items.map((item) => ({
            label: readLineLabel(item.label),
            quantity: item.quantity,
          })),
          equipment: order.equipment,
          serviceNotes: order.serviceNotes,
          clientNotes: order.notes,
        }),
    );
  }

  // ─────────────────────────── Interne ───────────────────────────

  private prepOrder(
    order: Awaited<ReturnType<ServiceDocumentsService['order']>>,
    timeZone: string,
  ): PrepOrder {
    const schedule = toSchedule(order, timeZone);
    return {
      reference: order.reference,
      eventTypeName: toLocalized(order.eventTypeRef.name),
      date: schedule.eventDate,
      startTime: schedule.startTime,
      guestCount: order.guestCount,
      city: order.city,
      items: preparationItems(order),
    };
  }

  private async order(traiteurId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, traiteurId },
      select: orderSelect,
    });
    if (!order) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
    return order;
  }

  private seller(traiteurId: string): Promise<Seller> {
    return this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: sellerSelect,
    });
  }

  private async publish(
    traiteurId: string,
    name: string,
    fileName: string,
    seller: Seller,
    build: (hasLogo: boolean) => Parameters<PdfService['render']>[0],
  ): Promise<Download> {
    const logo = await this.logo(seller);
    const { pdf } = await this.pdf.render(build(logo !== null), logo);
    const key = `${PRIVATE_PREFIX}traiteurs/${traiteurId}/service-documents/${name}.pdf`;
    await this.storage.putPrivate(key, pdf, 'application/pdf');
    return { url: await this.storage.signedDownloadUrl(key, fileName), fileName };
  }

  private async logo(seller: Seller): Promise<Buffer | null> {
    if (!seller.logoKey) return null;
    try {
      return await this.storage.download(seller.logoKey);
    } catch (error) {
      this.logger.warn(`Logo illisible (${seller.logoKey}) : ${String(error)}`);
      return null;
    }
  }
}
