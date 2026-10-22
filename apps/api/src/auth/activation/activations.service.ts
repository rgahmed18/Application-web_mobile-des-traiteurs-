import { Injectable } from '@nestjs/common';
import {
  type ActivationAcceptInput,
  type ActivationAcceptResult,
  maskPhone,
  passwordSchema,
  type PublicActivation,
} from '@traiteur/shared';

import { AuditService } from '../../audit/audit.service';
import { appErrors } from '../../common/errors';
import type { ClientInfo } from '../../common/http/client-info';
import { hashLinkToken, isLinkTokenShape } from '../../common/link-token';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../password.service';
import { TokenService } from '../token.service';

/**
 * Activation d'un compte de la plateforme par son lien (commande « super-admin create ») :
 * choix du mot de passe, une seule fois, dans les 24 heures. Jeton inconnu, utilisé ou expiré :
 * 404 (rien n'est révélé). La double authentification est imposée à la connexion suivante.
 */
@Injectable()
export class ActivationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async view(token: string): Promise<PublicActivation> {
    const activation = await this.find(token);
    return {
      firstName: activation.user.firstName,
      phone: maskPhone(activation.user.phone),
      expiresAt: activation.expiresAt.toISOString(),
    };
  }

  async accept(
    token: string,
    input: ActivationAcceptInput,
    client: ClientInfo,
  ): Promise<ActivationAcceptResult> {
    const activation = await this.find(token);
    const parsed = passwordSchema.safeParse(input.password);
    if (!parsed.success) {
      throw appErrors.badRequest(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Mot de passe invalide',
      );
    }
    const passwordHash = await this.passwords.hash(parsed.data);
    await this.prisma.$transaction(async (tx) => {
      // Usage unique : seule la première activation concurrente aboutit
      const { count } = await tx.accountActivation.updateMany({
        where: { id: activation.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (count === 0) throw appErrors.notFound('NOT_FOUND', 'Lien d’activation introuvable');
      await tx.user.update({
        where: { id: activation.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      await this.audit.record(
        {
          traiteurId: null,
          actor: null,
          action: 'super_admin.activated',
          entityType: 'User',
          entityId: activation.userId,
          client,
        },
        tx,
      );
    });
    await this.tokens.revokeAllForUser(activation.userId);
    return { phone: activation.user.phone };
  }

  private async find(token: string) {
    const notFound = () => appErrors.notFound('NOT_FOUND', 'Lien d’activation introuvable');
    if (!isLinkTokenShape(token)) throw notFound();
    const activation = await this.prisma.accountActivation.findUnique({
      where: { tokenHash: hashLinkToken(token) },
      include: {
        user: { select: { firstName: true, phone: true, status: true, isSuperAdmin: true } },
      },
    });
    if (
      !activation ||
      activation.usedAt ||
      activation.expiresAt <= new Date() ||
      activation.user.status !== 'ACTIVE' ||
      !activation.user.isSuperAdmin
    ) {
      throw notFound();
    }
    return activation;
  }
}
