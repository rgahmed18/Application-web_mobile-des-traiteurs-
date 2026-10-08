import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  type CatalogSettings,
  computeCatalogPrices,
  type Package,
  type PackageInput,
  type PackageListQuery,
  type PackagePage,
  resolveTaxRate,
  slugify,
} from '@traiteur/shared';

import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth-user';
import { appErrors } from '../../common/errors';
import type { ClientInfo } from '../../common/http/client-info';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  auditSnapshot,
  isUniqueViolation,
  jsonOrDbNull,
  loadCatalogSettings,
  notFound,
  requireTraiteurId,
  toIso,
  toLocalized,
  toLocalizedOrNull,
  uniqueSlug,
} from '../catalog-common';
import { MediaService } from '../media/media.service';

const packageInclude = {
  _count: { select: { orderItems: true, quoteLines: true } },
  dishes: {
    orderBy: { sortOrder: 'asc' },
    include: {
      dish: {
        select: {
          id: true,
          name: true,
          priceHt: true,
          priceTtc: true,
          unit: true,
          imageKey: true,
          isAvailable: true,
          archivedAt: true,
        },
      },
    },
  },
} satisfies Prisma.PackageInclude;
type PackageRow = Prisma.PackageGetPayload<{ include: typeof packageInclude }>;

function toPackage(row: PackageRow, settings: CatalogSettings): Package {
  return {
    id: row.id,
    slug: row.slug,
    name: toLocalized(row.name),
    description: toLocalizedOrNull(row.description),
    pricePerPersonHt: row.pricePerPersonHt,
    pricePerPersonTtc: row.pricePerPersonTtc,
    taxRateBps: row.taxRateBps,
    effectiveTaxRateBps: resolveTaxRate(settings, row.taxRateBps),
    minGuests: row.minGuests,
    maxGuests: row.maxGuests,
    imageKey: row.imageKey,
    isActive: row.isActive,
    archivedAt: toIso(row.archivedAt),
    dishes: row.dishes.map((line) => ({
      dishId: line.dishId,
      quantity: line.quantity,
      sortOrder: line.sortOrder,
      dish: {
        id: line.dish.id,
        name: toLocalized(line.dish.name),
        priceHt: line.dish.priceHt,
        priceTtc: line.dish.priceTtc,
        unit: line.dish.unit,
        imageKey: line.dish.imageKey,
        isAvailable: line.dish.isAvailable,
        archivedAt: toIso(line.dish.archivedAt),
      },
    })),
    inUse: row._count.orderItems + row._count.quoteLines > 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

@Injectable()
export class PackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  async list(user: AuthenticatedUser, query: PackageListQuery): Promise<PackagePage> {
    const traiteurId = requireTraiteurId(user);
    const search = query.search?.trim();
    const where: Prisma.PackageWhereInput = {
      traiteurId,
      archivedAt: query.archived ? { not: null } : null,
      ...(query.status ? { isActive: query.status === 'active' } : {}),
      ...(search
        ? {
            OR: [
              { slug: { contains: slugify(search, search.toLowerCase()) } },
              { name: { path: ['fr'], string_contains: search } },
              { name: { path: ['ar'], string_contains: search } },
            ],
          }
        : {}),
    };
    const [settings, total, rows] = await Promise.all([
      loadCatalogSettings(this.prisma, traiteurId),
      this.prisma.package.count({ where }),
      this.prisma.package.findMany({
        where,
        include: packageInclude,
        orderBy: [{ slug: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => toPackage(row, settings)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(user: AuthenticatedUser, id: string): Promise<Package> {
    const traiteurId = requireTraiteurId(user);
    const [settings, row] = await Promise.all([
      loadCatalogSettings(this.prisma, traiteurId),
      this.prisma.package.findFirst({ where: { id, traiteurId }, include: packageInclude }),
    ]);
    if (!row) notFound();
    return toPackage(row, settings);
  }

  async create(user: AuthenticatedUser, input: PackageInput, client: ClientInfo): Promise<Package> {
    const traiteurId = requireTraiteurId(user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const settings = await loadCatalogSettings(tx, traiteurId);
        await this.assertDishes(tx, traiteurId, input, new Set());
        const id = randomUUID();
        const slug = await uniqueSlug(input.name, 'formule', async (candidate) =>
          Boolean(
            await tx.package.findUnique({
              where: { traiteurId_slug: { traiteurId, slug: candidate } },
            }),
          ),
        );
        const imageKey = input.imageKey
          ? await this.media.attach(tx, traiteurId, input.imageKey, 'Package', id)
          : null;
        await tx.package.create({
          data: { id, traiteurId, slug, ...this.toData(input, settings), imageKey },
        });
        await this.replaceComposition(tx, traiteurId, id, input);

        const result = toPackage(
          await tx.package.findUniqueOrThrow({ where: { id }, include: packageInclude }),
          settings,
        );
        await this.audit.record(
          {
            traiteurId,
            actor: user,
            action: 'catalog.package.created',
            entityType: 'Package',
            entityId: id,
            after: auditSnapshot(result),
            client,
          },
          tx,
        );
        return result;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw appErrors.conflict('SLUG_TAKEN', 'Nom déjà utilisé');
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: PackageInput,
    client: ClientInfo,
  ): Promise<Package> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.package.findFirst({
        where: { id, traiteurId },
        include: packageInclude,
      });
      if (!existing) notFound();
      // Un plat archivé déjà présent peut rester ; un plat archivé ne peut pas être ajouté.
      await this.assertDishes(
        tx,
        traiteurId,
        input,
        new Set(existing.dishes.map((line) => line.dishId)),
      );

      let imageKey = existing.imageKey;
      if (input.imageKey !== existing.imageKey) {
        if (existing.imageKey) await this.media.detach(tx, traiteurId, existing.imageKey);
        imageKey = input.imageKey
          ? await this.media.attach(tx, traiteurId, input.imageKey, 'Package', id)
          : null;
      }
      await tx.package.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: { ...this.toData(input, settings), imageKey },
      });
      await this.replaceComposition(tx, traiteurId, id, input);

      const result = toPackage(
        await tx.package.findUniqueOrThrow({ where: { id }, include: packageInclude }),
        settings,
      );
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.package.updated',
          entityType: 'Package',
          entityId: id,
          before: auditSnapshot(toPackage(existing, settings)),
          after: auditSnapshot(result),
          client,
        },
        tx,
      );
      return result;
    });
  }

  archive(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<Package> {
    return this.setArchived(user, id, new Date(), 'catalog.package.archived', client);
  }

  restore(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<Package> {
    return this.setArchived(user, id, null, 'catalog.package.restored', client);
  }

  async remove(user: AuthenticatedUser, id: string, client: ClientInfo): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.package.findFirst({
        where: { id, traiteurId },
        include: packageInclude,
      });
      if (!existing) notFound();
      if (existing._count.orderItems + existing._count.quoteLines > 0) {
        throw appErrors.conflict('ITEM_IN_USE', 'Formule utilisée dans une commande ou un devis');
      }
      if (existing.imageKey) await this.media.detach(tx, traiteurId, existing.imageKey);
      await tx.package.delete({ where: { id_traiteurId: { id, traiteurId } } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.package.deleted',
          entityType: 'Package',
          entityId: id,
          before: auditSnapshot(toPackage(existing, settings)),
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
  ): Promise<Package> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await loadCatalogSettings(tx, traiteurId);
      const existing = await tx.package.findFirst({ where: { id, traiteurId } });
      if (!existing) notFound();
      const row = await tx.package.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: { archivedAt },
        include: packageInclude,
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action,
          entityType: 'Package',
          entityId: id,
          before: auditSnapshot({ archivedAt: toIso(existing.archivedAt) }),
          after: auditSnapshot({ archivedAt: toIso(archivedAt) }),
          client,
        },
        tx,
      );
      return toPackage(row, settings);
    });
  }

  private toData(input: PackageInput, settings: CatalogSettings) {
    const prices = computeCatalogPrices(
      input.pricePerPerson,
      settings.priceEntryMode,
      resolveTaxRate(settings, input.taxRateBps),
    );
    return {
      name: input.name,
      description: jsonOrDbNull(input.description),
      pricePerPersonHt: prices.priceHt,
      pricePerPersonTtc: prices.priceTtc,
      taxRateBps: input.taxRateBps,
      minGuests: input.minGuests,
      maxGuests: input.maxGuests,
      isActive: input.isActive,
    };
  }

  /** Les plats de la composition appartiennent au traiteur ; pas d'ajout de plat archivé. */
  private async assertDishes(
    tx: Prisma.TransactionClient,
    traiteurId: string,
    input: PackageInput,
    alreadyInPackage: ReadonlySet<string>,
  ): Promise<void> {
    const ids = input.dishes.map((line) => line.dishId);
    const dishes = await tx.dish.findMany({
      where: { traiteurId, id: { in: ids } },
      select: { id: true, archivedAt: true },
    });
    if (dishes.length !== new Set(ids).size) notFound();
    const archivedAddition = dishes.some(
      (dish) => dish.archivedAt && !alreadyInPackage.has(dish.id),
    );
    if (archivedAddition) {
      throw appErrors.badRequest('ITEM_ARCHIVED', 'Un plat archivé ne peut pas être ajouté');
    }
  }

  private async replaceComposition(
    tx: Prisma.TransactionClient,
    traiteurId: string,
    packageId: string,
    input: PackageInput,
  ): Promise<void> {
    await tx.packageDish.deleteMany({ where: { packageId, traiteurId } });
    await tx.packageDish.createMany({
      data: input.dishes.map((line, index) => ({
        traiteurId,
        packageId,
        dishId: line.dishId,
        quantity: line.quantity,
        sortOrder: index,
      })),
    });
  }
}
