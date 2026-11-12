import { Injectable } from '@nestjs/common';
import type { ClientAccount } from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

/** Fiche CLIENT de la session : toujours celle du token, jamais un identifiant envoyé. */
export interface ClientContext {
  traiteurId: string;
  membershipId: string;
  userId: string;
}

/** Client connecté chez CE traiteur (rôle CLIENT, fiche de la session) ; sinon 403. */
export function requireClient(user: AuthenticatedUser): ClientContext {
  if (user.role !== 'CLIENT' || !user.traiteurId || !user.membershipId) {
    throw appErrors.forbidden('FORBIDDEN_ROLE', 'Espace réservé aux clients');
  }
  return { traiteurId: user.traiteurId, membershipId: user.membershipId, userId: user.userId };
}

/** Compte du client sur le site du traiteur : sa fiche chez CE traiteur et l'accord reçu. */
@Injectable()
export class ClientAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthenticatedUser): Promise<ClientAccount> {
    const { traiteurId, membershipId } = requireClient(user);
    const row = await this.prisma.membership.findFirst({
      where: { id: membershipId, traiteurId, role: 'CLIENT' },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        locale: true,
        clientApproval: true,
        clientRejectionReason: true,
        user: { select: { phone: true } },
      },
    });
    if (!row) throw appErrors.forbidden('FORBIDDEN_ROLE', 'Espace réservé aux clients');
    return {
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.user.phone,
      email: row.email,
      locale: row.locale,
      approval: row.clientApproval,
      rejectionReason: row.clientRejectionReason,
      canRequest: row.clientApproval === 'APPROVED',
    };
  }
}
