import { Injectable } from '@nestjs/common';
import type { Category, CategoryInput, CategoryReorderInput } from '@traiteur/shared';

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
  notFound,
  requireTraiteurId,
  toIso,
  toLocalized,
  toLocalizedOrNull,
  uniqueSlug,
} from '../catalog-common';

const categoryInclude = {
  _count: { select: { dishes: { where: { archivedAt: null } } } },
} satisfies Prisma.CategoryInclude;
type CategoryRow = Prisma.CategoryGetPayload<{ include: typeof categoryInclude }>;

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: toLocalized(row.name),
    description: toLocalizedOrNull(row.description),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    dishCount: row._count.dishes,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser): Promise<Category[]> {
    const traiteurId = requireTraiteurId(user);
    const rows = await this.prisma.category.findMany({
      where: { traiteurId },
      include: categoryInclude,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toCategory);
  }

  async create(
    user: AuthenticatedUser,
    input: CategoryInput,
    client: ClientInfo,
  ): Promise<Category> {
    const traiteurId = requireTraiteurId(user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const slug = await uniqueSlug(input.name, 'categorie', async (candidate) =>
          Boolean(
            await tx.category.findUnique({
              where: { traiteurId_slug: { traiteurId, slug: candidate } },
            }),
          ),
        );
        const last = await tx.category.aggregate({
          where: { traiteurId },
          _max: { sortOrder: true },
        });
        const row = await tx.category.create({
          data: {
            traiteurId,
            slug,
            name: input.name,
            description: jsonOrDbNull(input.description),
            isActive: input.isActive,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
          include: categoryInclude,
        });
        const category = toCategory(row);
        await this.audit.record(
          {
            traiteurId,
            actor: user,
            action: 'catalog.category.created',
            entityType: 'Category',
            entityId: row.id,
            after: auditSnapshot(category),
            client,
          },
          tx,
        );
        return category;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw appErrors.conflict('SLUG_TAKEN', 'Nom déjà utilisé');
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: CategoryInput,
    client: ClientInfo,
  ): Promise<Category> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.category.findFirst({
        where: { id, traiteurId },
        include: categoryInclude,
      });
      if (!existing) notFound();
      const row = await tx.category.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: {
          name: input.name,
          description: jsonOrDbNull(input.description),
          isActive: input.isActive,
        },
        include: categoryInclude,
      });
      const category = toCategory(row);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.category.updated',
          entityType: 'Category',
          entityId: id,
          before: auditSnapshot(toCategory(existing)),
          after: auditSnapshot(category),
          client,
        },
        tx,
      );
      return category;
    });
  }

  /** Nouvel ordre d'affichage (glisser-déposer) : uniquement des catégories du traiteur. */
  async reorder(
    user: AuthenticatedUser,
    input: CategoryReorderInput,
    client: ClientInfo,
  ): Promise<Category[]> {
    const traiteurId = requireTraiteurId(user);
    const ids = [...new Set(input.ids)];
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.category.count({ where: { traiteurId, id: { in: ids } } });
      if (owned !== ids.length) notFound();
      for (const [index, id] of ids.entries()) {
        await tx.category.update({
          where: { id_traiteurId: { id, traiteurId } },
          data: { sortOrder: index },
        });
      }
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'catalog.category.reordered',
          entityType: 'Category',
          after: auditSnapshot({ ids }),
          client,
        },
        tx,
      );
    });
    return this.list(user);
  }
}
