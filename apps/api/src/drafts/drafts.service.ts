import { Injectable } from '@nestjs/common';
import {
  DRAFT_MAX_BYTES,
  DRAFT_TTL_DAYS,
  type Draft,
  type DraftList,
  type DraftSaveInput,
  type DraftSummary,
  stripSensitiveFields,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

const summarySelect = {
  formKey: true,
  label: true,
  baseVersion: true,
  updatedAt: true,
} as const;

/**
 * Brouillons des formulaires du back-office, côté serveur. Toujours limités à l'utilisateur ET
 * au traiteur de la session ; pour le super admin entré chez un traiteur, à son accès en cours
 * (supprimés à sa fin). Aucune route de la console n'y accède. Le contenu n'est jamais
 * journalisé ni tracé dans l'audit.
 */
@Injectable()
export class DraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser): Promise<DraftList> {
    const rows = await this.prisma.formDraft.findMany({
      where: { ...this.owner(user), expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
      select: summarySelect,
    });
    return { drafts: rows.map((row) => this.toSummary(row)) };
  }

  async get(user: AuthenticatedUser, formKey: string): Promise<Draft> {
    const row = await this.prisma.formDraft.findFirst({
      where: { ...this.owner(user), formKey, expiresAt: { gt: new Date() } },
      select: { ...summarySelect, data: true },
    });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Brouillon introuvable');
    return { ...this.toSummary(row), data: row.data as Record<string, unknown> };
  }

  /** Enregistre (ou remplace) le brouillon ; les champs sensibles sont retirés ici aussi. */
  async save(
    user: AuthenticatedUser,
    formKey: string,
    input: DraftSaveInput,
  ): Promise<DraftSummary> {
    const data = stripSensitiveFields(input.data) as Prisma.InputJsonObject;
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > DRAFT_MAX_BYTES) {
      throw appErrors.badRequest('DRAFT_TOO_LARGE', 'Brouillon trop volumineux');
    }
    const owner = this.owner(user);
    const expiresAt = new Date(Date.now() + DRAFT_TTL_DAYS * DAY_MS);
    const row = await this.prisma.formDraft.upsert({
      where: {
        userId_traiteurId_formKey: {
          userId: owner.userId,
          traiteurId: owner.traiteurId,
          formKey,
        },
      },
      create: {
        ...owner,
        formKey,
        label: input.label,
        baseVersion: input.baseVersion,
        data,
        expiresAt,
      },
      update: {
        // Un brouillon d'un accès précédent du super admin n'est jamais repris par un autre
        platformAccessId: owner.platformAccessId,
        label: input.label,
        baseVersion: input.baseVersion,
        data,
        expiresAt,
      },
      select: summarySelect,
    });
    return this.toSummary(row);
  }

  async remove(user: AuthenticatedUser, formKey: string): Promise<void> {
    await this.prisma.formDraft.deleteMany({ where: { ...this.owner(user), formKey } });
  }

  /** Purge : brouillons expirés et brouillons d'un accès du super admin terminé. */
  async purge(now = new Date()): Promise<number> {
    const { count } = await this.prisma.formDraft.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { platformAccess: { endedAt: { not: null } } },
          { platformAccess: { expiresAt: { lte: now } } },
        ],
      },
    });
    return count;
  }

  /**
   * Propriétaire : l'utilisateur chez le traiteur de la session. Le super admin n'a de
   * brouillons que pendant un accès chez un traiteur (jamais dans la console).
   */
  private owner(user: AuthenticatedUser) {
    const traiteurId = requireTraiteurId(user);
    if (user.isSuperAdmin && !user.platformAccessId) {
      throw appErrors.forbidden('PLATFORM_ACCESS_REQUIRED', 'Brouillons indisponibles ici');
    }
    return {
      userId: user.userId,
      traiteurId,
      platformAccessId: user.isSuperAdmin ? user.platformAccessId : null,
    };
  }

  private toSummary(row: {
    formKey: string;
    label: string | null;
    baseVersion: string | null;
    updatedAt: Date;
  }): DraftSummary {
    return {
      formKey: row.formKey,
      label: row.label,
      baseVersion: row.baseVersion,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
