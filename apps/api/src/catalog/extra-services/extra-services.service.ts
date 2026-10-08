import { Injectable } from '@nestjs/common';
import {
  type CatalogSettings,
  computeCatalogPrices,
  type ExtraService,
  type ExtraServiceInput,
  resolveTaxRate,
} from '@traiteur/shared';

import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth-user';
import { appErrors } from '../../common/errors';
import type { ClientInfo } from '../../common/http/client-info';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  auditSnapshot,
  jsonOrDbNull,
  loadCatalogSettings,
  notFound,
  requireTraiteurId,
  toIso,
  toLocalized,
  toLocalizedOrNull,
} from '../catalog-common';

const serviceInclude = {
  _count: { select: { orderItems: true, quoteLines: true } },
} satisfies Prisma.ExtraServiceInclude;
type ServiceRow = Prisma.ExtraServiceGetPayload<{ include: typeof serviceInclude }>;

function toExtraService(row: ServiceRow, settings: CatalogSettings): ExtraService {
  return {
    id: row.id,
    name: toLocalized(row.name),
    description: toLocalizedOrNull(row.description),
    priceHt: row.priceHt,
    priceTtc: row.priceTtc,
    taxRateBps: row.taxRateBps,
    effectiveTaxRateBps: resolveTaxRate(settings, row.taxRateBps),
    pricingUnit: row.pricingUnit,
    isActive: row.isActive,
    archivedAt: toIso(row.archivedAt),
    inUse: row._count.orderItems + row._count.quoteLines > 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

@Injectable()
export class ExtraServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, archived = false): Promise<ExtraService[]> {
    const traiteurId = requireTraiteurId(user);
    const [settings, rows] = await Promise.all([
      loadCatalogSettings(this.prisma, traiteurId),
      this.prisma.extraService.findMany({
        where: { traiteurId, archivedAt: archived ? { not: null } : null },
        include: serviceInclude,
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return rows.map((row) => toExtraService(row, settings));
  }

  async create(
    user: AuthenticatedUser,
    input: ExtraServiceInput,
    client: ClientInfo,
  ): Promise<ExtraService> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const row = await tx.extraService.create({
        data: { traiteurId, ...this.toData(input, settings) },
        include: serviceInclude,
      });
      const service = toExtraService(row, settings);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.service.created',
          entityType: 'ExtraService',
          entityId: row.id,
          after: auditSnapshot(service),
          client,
        },
        tx,
      );
      return service;
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: ExtraServiceInput,
    client: ClientInfo,
  ): Promise<ExtraService> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.extraService.findFirst({
        where: { id, traiteurId },
        include: serviceInclude,
      });
      if (!existing) notFound();
      const row = await tx.extraService.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: this.toData(input, settings),
        include: serviceInclude,
      });
      const service = toExtraService(row, settings);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.service.updated',
          entityType: 'ExtraService',
          entityId: id,
          before: auditSnapshot(toExtraService(existing, settings)),
          after: auditSnapshot(service),
          client,
        },
        tx,
      );
      return service;
    });
  }

  archive(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<ExtraService> {
    return this.setArchived(user, id, new Date(), 'catalog.service.archived', client);
  }

  restore(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<ExtraService> {
    return this.setArchived(user, id, null, 'catalog.service.restored', client);
  }

  async remove(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.extraService.findFirst({
        where: { id, traiteurId },
        include: serviceInclude,
      });
      if (!existing) notFound();
      if (existing._count.orderItems + existing._count.quoteLines > 0) {
        throw appErrors.conflict('ITEM_IN_USE', 'Service utilisé dans une commande ou un devis');
      }
      await tx.extraService.delete({ where: { id_traiteurId: { id, traiteurId } } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.service.deleted',
          entityType: 'ExtraService',
          entityId: id,
          before: auditSnapshot(toExtraService(existing, settings)),
          client,
        },
        tx,
      );
    });
  }

  private async setArchived(
    user: AuthenticatedUser,
    id: string,
    archivedAt: Date | null,
    action: string,
    client: ClientInfo,
  ): Promise<ExtraService> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.extraService.findFirst({ where: { id, traiteurId } });
      if (!existing) notFound();
      const row = await tx.extraService.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: { archivedAt },
        include: serviceInclude,
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action,
          entityType: 'ExtraService',
          entityId: id,
          before: auditSnapshot({ archivedAt: toIso(existing.archivedAt) }),
          after: auditSnapshot({ archivedAt: toIso(archivedAt) }),
          client,
        },
        tx,
      );
      return toExtraService(row, settings);
    });
  }

  private toData(input: ExtraServiceInput, settings: CatalogSettings) {
    const prices = computeCatalogPrices(
      input.price,
      settings.priceEntryMode,
      resolveTaxRate(settings, input.taxRateBps),
    );
    return {
      name: input.name,
      description: jsonOrDbNull(input.description),
      priceHt: prices.priceHt,
      priceTtc: prices.priceTtc,
      taxRateBps: input.taxRateBps,
      pricingUnit: input.pricingUnit,
      isActive: input.isActive,
    };
  }
}
