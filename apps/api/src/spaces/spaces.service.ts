import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  classifyHost,
  type DemoSpaces,
  type HostKind,
  type Space,
  type SpaceHostConfig,
} from '@traiteur/shared';

import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { tenantUrlFromTemplate } from './tenant-url';

/** Résolutions gardées 30 secondes : la page de connexion et le serveur web les demandent souvent. */
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 1_000;

const traiteurSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  logoKey: true,
} as const;

/**
 * Espaces servis par une adresse : console de la plateforme ou back-office d'un traiteur. Le
 * traiteur vient TOUJOURS de l'adresse (sous-domaine ou domaine personnalisé vérifié), jamais du
 * navigateur. Un traiteur résilié ou une adresse inconnue : aucun espace (« Espace introuvable »).
 */
@Injectable()
export class SpacesService {
  private readonly logger = new Logger(SpacesService.name);
  private readonly hosts: SpaceHostConfig;
  private readonly urlTemplate: string;
  private readonly demoSelection: boolean;
  private readonly cache = new Map<string, { value: Space | null; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.hosts = {
      baseDomain: config.get('TENANT_BASE_DOMAIN', { infer: true }),
      platformHostnames: config.get('PLATFORM_HOSTNAMES', { infer: true }),
    };
    this.urlTemplate = config.get('TENANT_URL_TEMPLATE', { infer: true });
    this.demoSelection = config.get('DEMO_SPACE_SELECTION', { infer: true });
  }

  /** Espace d'une adresse (en-tête Host) ; null si elle n'en sert aucun. */
  async resolve(host: string): Promise<Space | null> {
    const kind = classifyHost(host, this.hosts);
    if (!kind) return null;
    if (kind.kind === 'platform') return { kind: 'platform' };

    const key = kind.kind === 'subdomain' ? `slug:${kind.slug}` : `host:${kind.hostname}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.lookup(kind);
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.clear();
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /** Après un changement (domaine, statut) : la prochaine résolution relit la base. */
  invalidate(): void {
    this.cache.clear();
  }

  /** Démonstration (DEMO_SPACE_SELECTION) : traiteurs proposés au choix ; null sinon. */
  async demoSpaces(): Promise<DemoSpaces | null> {
    if (!this.demoSelection) return null;
    const traiteurs = await this.prisma.traiteur.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      orderBy: { name: 'asc' },
      select: { slug: true, name: true },
    });
    return { traiteurs };
  }

  /** Démonstration (DEMO_SPACE_SELECTION) : espace du traiteur choisi ; null sinon. */
  async demoSpace(slug: string): Promise<Space | null> {
    if (!this.demoSelection || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
    return this.lookup({ kind: 'subdomain', slug });
  }

  /** Adresse publique du back-office d'un traiteur : liens d'invitation et de devis. */
  async tenantUrl(traiteurId: string): Promise<string> {
    const traiteur = await this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { slug: true },
    });
    return tenantUrlFromTemplate(this.urlTemplate, traiteur.slug);
  }

  private async lookup(kind: Exclude<HostKind, { kind: 'platform' }>): Promise<Space | null> {
    // Domaines personnalisés : ajoutés avec leur vérification (console)
    if (kind.kind !== 'subdomain') return null;
    const traiteur = await this.prisma.traiteur.findUnique({
      where: { slug: kind.slug },
      select: traiteurSelect,
    });
    if (!traiteur || traiteur.status === 'CANCELLED') return null;
    return {
      kind: 'traiteur',
      traiteur: {
        id: traiteur.id,
        slug: traiteur.slug,
        name: traiteur.name,
        logoUrl: await this.logoUrl(traiteur.id, traiteur.logoKey),
        status: traiteur.status,
      },
    };
  }

  private async logoUrl(traiteurId: string, logoKey: string | null): Promise<string | null> {
    if (!logoKey) return null;
    try {
      return await this.storage.signedDownloadUrl(logoKey, 'logo.png', 3600);
    } catch (error) {
      this.logger.warn(`Logo du traiteur ${traiteurId} indisponible : ${String(error)}`);
      return null;
    }
  }
}
