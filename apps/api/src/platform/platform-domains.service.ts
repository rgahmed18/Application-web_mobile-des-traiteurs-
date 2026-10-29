import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  classifyHost,
  DOMAIN_VERIFICATION_LABEL,
  DOMAIN_VERIFICATION_PREFIX,
  type PlatformDomains,
  type SpaceHostConfig,
  type TraiteurDomainStatus,
} from '@traiteur/shared';

import { FeaturesService } from '../access/features.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import type { Env } from '../config/env.schema';
import type { Prisma, TraiteurDomain } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SpacesService } from '../spaces/spaces.service';

/** Lecture des enregistrements TXT d'un nom (remplacée dans les tests). */
export const DNS_TXT_RESOLVER = Symbol('DNS_TXT_RESOLVER');
export type DnsTxtResolver = (name: string) => Promise<string[][]>;
export const dnsTxtResolverProvider = { provide: DNS_TXT_RESOLVER, useValue: resolveTxt };

/**
 * Domaines personnalisés (offre Premium), gérés depuis la console : ajout (en attente), preuve
 * de propriété par un enregistrement DNS TXT, puis activation. Seul un domaine vérifié et actif,
 * d'un traiteur dont la fonctionnalité « Domaine personnalisé » est active, est servi et reçoit
 * un certificat HTTPS (Caddy « ask » → /public/spaces/tls-check).
 */
@Injectable()
export class PlatformDomainsService {
  private readonly hosts: SpaceHostConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly features: FeaturesService,
    private readonly spaces: SpacesService,
    @Inject(DNS_TXT_RESOLVER) private readonly resolveTxtRecords: DnsTxtResolver,
    config: ConfigService<Env, true>,
  ) {
    this.hosts = {
      baseDomain: config.get('TENANT_BASE_DOMAIN', { infer: true }),
      platformHostnames: config.get('PLATFORM_HOSTNAMES', { infer: true }),
    };
  }

  async list(traiteurId: string): Promise<PlatformDomains> {
    const traiteur = await this.prisma.traiteur.findUnique({
      where: { id: traiteurId },
      select: { slug: true },
    });
    if (!traiteur) throw appErrors.notFound('TRAITEUR_NOT_FOUND', 'Traiteur introuvable');
    const [featureEnabled, domains] = await Promise.all([
      this.features.isEnabled(traiteurId, 'custom_domain'),
      this.prisma.traiteurDomain.findMany({
        where: { traiteurId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      featureEnabled,
      target: `${traiteur.slug}.${this.hosts.baseDomain}`,
      domains: domains.map((domain) => this.toDto(domain)),
    };
  }

  async add(
    user: AuthenticatedUser,
    traiteurId: string,
    input: string,
    client: ClientInfo,
  ): Promise<PlatformDomains> {
    const kind = classifyHost(input, this.hosts);
    if (kind?.kind !== 'custom') {
      throw appErrors.badRequest(
        'DOMAIN_INVALID',
        'Domaine invalide : un nom comme « traiteur-exemple.ma », hors des adresses de la plateforme',
      );
    }
    await this.list(traiteurId); // traiteur existant
    if (!(await this.features.isEnabled(traiteurId, 'custom_domain'))) {
      throw appErrors.conflict(
        'DOMAIN_FEATURE_REQUIRED',
        'La fonctionnalité « Domaine personnalisé » n’est pas active pour ce traiteur',
      );
    }
    const taken = await this.prisma.traiteurDomain.findUnique({
      where: { hostname: kind.hostname },
      select: { id: true },
    });
    if (taken) throw appErrors.conflict('DOMAIN_TAKEN', 'Ce domaine est déjà enregistré');

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.traiteurDomain.create({
        data: {
          traiteurId,
          hostname: kind.hostname,
          verificationToken: randomBytes(24).toString('base64url'),
        },
      });
      await this.record(tx, user, traiteurId, 'platform.domain_added', created, client);
    });
    return this.list(traiteurId);
  }

  /** Cherche l'enregistrement TXT ; trouvé : le domaine devient actif (servi). */
  async verify(
    user: AuthenticatedUser,
    traiteurId: string,
    domainId: string,
    client: ClientInfo,
  ): Promise<PlatformDomains> {
    const domain = await this.find(traiteurId, domainId);
    if (!(await this.features.isEnabled(traiteurId, 'custom_domain'))) {
      throw appErrors.conflict(
        'DOMAIN_FEATURE_REQUIRED',
        'La fonctionnalité « Domaine personnalisé » n’est pas active pour ce traiteur',
      );
    }
    const expected = `${DOMAIN_VERIFICATION_PREFIX}${domain.verificationToken}`;
    let error: string | null = null;
    try {
      const records = await this.resolveTxtRecords(
        `${DOMAIN_VERIFICATION_LABEL}.${domain.hostname}`,
      );
      if (!records.some((chunks) => chunks.join('') === expected)) {
        error = 'Enregistrement TXT trouvé, mais avec une autre valeur';
      }
    } catch {
      error = 'Enregistrement TXT introuvable (la propagation DNS peut prendre jusqu’à 24 h)';
    }

    const now = new Date();
    if (error) {
      await this.prisma.traiteurDomain.update({
        where: { id: domain.id },
        data: { lastCheckedAt: now, lastCheckError: error },
      });
      throw appErrors.conflict('DOMAIN_NOT_VERIFIED', error);
    }
    await this.prisma.$transaction(async (tx) => {
      const verified = await tx.traiteurDomain.update({
        where: { id: domain.id },
        data: { status: 'ACTIVE', verifiedAt: now, lastCheckedAt: now, lastCheckError: null },
      });
      await this.record(tx, user, traiteurId, 'platform.domain_verified', verified, client);
    });
    this.spaces.invalidate();
    return this.list(traiteurId);
  }

  /** Coupe le domaine : plus servi ni renouvelé ; une nouvelle vérification le réactive. */
  async disable(
    user: AuthenticatedUser,
    traiteurId: string,
    domainId: string,
    client: ClientInfo,
  ): Promise<PlatformDomains> {
    const domain = await this.find(traiteurId, domainId);
    await this.prisma.$transaction(async (tx) => {
      const disabled = await tx.traiteurDomain.update({
        where: { id: domain.id },
        data: { status: 'DISABLED' },
      });
      await this.record(tx, user, traiteurId, 'platform.domain_disabled', disabled, client, domain);
    });
    this.spaces.invalidate();
    return this.list(traiteurId);
  }

  async remove(
    user: AuthenticatedUser,
    traiteurId: string,
    domainId: string,
    client: ClientInfo,
  ): Promise<PlatformDomains> {
    const domain = await this.find(traiteurId, domainId);
    await this.prisma.$transaction(async (tx) => {
      await tx.traiteurDomain.delete({ where: { id: domain.id } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'platform.domain_removed',
          entityType: 'TraiteurDomain',
          entityId: domain.id,
          before: { hostname: domain.hostname, status: domain.status },
          client,
        },
        tx,
      );
    });
    this.spaces.invalidate();
    return this.list(traiteurId);
  }

  private async find(traiteurId: string, domainId: string): Promise<TraiteurDomain> {
    const domain = await this.prisma.traiteurDomain.findFirst({
      where: { id: domainId, traiteurId },
    });
    if (!domain) throw appErrors.notFound('NOT_FOUND', 'Domaine introuvable');
    return domain;
  }

  private record(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    traiteurId: string,
    action: string,
    domain: TraiteurDomain,
    client: ClientInfo,
    before?: TraiteurDomain,
  ): Promise<void> {
    return this.audit.record(
      {
        traiteurId,
        actor: user,
        action,
        entityType: 'TraiteurDomain',
        entityId: domain.id,
        ...(before ? { before: { hostname: before.hostname, status: before.status } } : {}),
        after: { hostname: domain.hostname, status: domain.status as TraiteurDomainStatus },
        client,
      },
      tx,
    );
  }

  private toDto(domain: TraiteurDomain): PlatformDomains['domains'][number] {
    return {
      id: domain.id,
      hostname: domain.hostname,
      status: domain.status as TraiteurDomainStatus,
      verification: {
        name: `${DOMAIN_VERIFICATION_LABEL}.${domain.hostname}`,
        value: `${DOMAIN_VERIFICATION_PREFIX}${domain.verificationToken}`,
      },
      verifiedAt: domain.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
      lastCheckError: domain.lastCheckError,
      createdAt: domain.createdAt.toISOString(),
    };
  }
}
