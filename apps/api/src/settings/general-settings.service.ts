import { Injectable } from '@nestjs/common';
import {
  availabilitySettingsVersion,
  companySettingsVersion,
  pricingSettingsVersion,
  type AvailabilitySettings,
  type CompanySettings,
  type PricingSettings,
  type PricingSettingsInput,
  type AuditAction,
  parseLocalizedText,
  type SiteSettings,
  siteEventTypePhotoSchema,
  siteFeaturedItemSchema,
  sitePaletteSchema,
  DEFAULT_SITE_PALETTE,
  siteSettingsVersion,
} from '@traiteur/shared';
import { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { jsonOrDbNull } from '../catalog/catalog-common';
import { MediaService } from '../catalog/media/media.service';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertEditVersion, lockRow } from '../common/http/edit-version';

const companySelect = {
  name: true,
  email: true,
  phone: true,
  city: true,
} satisfies Prisma.TraiteurSelect;

const availabilitySelect = {
  maxEventsPerDay: true,
  closedWeekdays: true,
  missionRedactionDays: true,
  equipmentSetupHours: true,
  equipmentReturnHours: true,
} satisfies Prisma.TraiteurSelect;

const pricingSelect = {
  priceEntryMode: true,
  isVatRegistered: true,
  defaultTaxRateBps: true,
} satisfies Prisma.TraiteurSelect;

const siteSelect = {
  requireClientApproval: true,
  siteIntro: true,
  sitePhotoKeys: true,
  privacyExtra: true,
  cndpDeclaration: true,
  sitePalette: true,
  siteWhatsappPhone: true,
  siteFeatured: true,
  siteEventTypePhotos: true,
} satisfies Prisma.TraiteurSelect;

/** Listes JSON relues avec leur schéma (contenu invalide : liste vide). */
const featuredList = z.array(siteFeaturedItemSchema);
const eventTypePhotoList = z.array(siteEventTypePhotoSchema);

function toSiteSettings(
  row: Prisma.TraiteurGetPayload<{ select: typeof siteSelect }>,
): SiteSettings {
  return {
    requireClientApproval: row.requireClientApproval,
    intro: row.siteIntro === null ? null : parseLocalizedText(row.siteIntro),
    photoKeys: row.sitePhotoKeys,
    privacyExtra: row.privacyExtra === null ? null : parseLocalizedText(row.privacyExtra),
    cndpDeclaration: row.cndpDeclaration,
    palette: sitePaletteSchema.safeParse(row.sitePalette).data ?? DEFAULT_SITE_PALETTE,
    whatsappPhone: row.siteWhatsappPhone,
    featured: featuredList.safeParse(row.siteFeatured).data ?? [],
    eventTypePhotos: eventTypePhotoList.safeParse(row.siteEventTypePhotos).data ?? [],
  };
}

/** Clés des photos du site : accueil, puis types d'événement. */
function siteImageKeys(settings: Pick<SiteSettings, 'photoKeys' | 'eventTypePhotos'>): string[] {
  return [...settings.photoKeys, ...settings.eventTypePhotos.map((photo) => photo.imageKey)];
}

/** Réglages lus (texte, nombres, listes de nombres) : valeurs JSON telles quelles pour l'audit. */
const snapshot = (value: object) => ({ ...value }) as Prisma.InputJsonObject;

/**
 * Paramètres généraux du traiteur : entreprise (coordonnées), disponibilités (capacité par jour,
 * fermeture hebdomadaire, masquage des missions terminées) et mode de saisie des prix. Chaque
 * modification est tracée avec l'état avant et après.
 */
@Injectable()
export class GeneralSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  company(user: AuthenticatedUser): Promise<CompanySettings> {
    return this.read(user, companySelect);
  }

  updateCompany(
    user: AuthenticatedUser,
    input: CompanySettings,
    client: ClientInfo,
    expectedVersion: string | null = null,
  ): Promise<CompanySettings> {
    return this.write(user, companySelect, input, 'settings.company_updated', client, {
      expected: expectedVersion,
      of: companySettingsVersion,
    });
  }

  availability(user: AuthenticatedUser): Promise<AvailabilitySettings> {
    return this.read(user, availabilitySelect);
  }

  updateAvailability(
    user: AuthenticatedUser,
    input: AvailabilitySettings,
    client: ClientInfo,
    expectedVersion: string | null = null,
  ): Promise<AvailabilitySettings> {
    return this.write(user, availabilitySelect, input, 'settings.availability_updated', client, {
      expected: expectedVersion,
      of: availabilitySettingsVersion,
    });
  }

  pricing(user: AuthenticatedUser): Promise<PricingSettings> {
    return this.read(user, pricingSelect);
  }

  /**
   * Mode de saisie des prix : s'applique aux nouveaux prix et aux nouveaux documents. Les
   * commandes, devis et factures existants gardent le mode figé à leur création ; le catalogue
   * stocke déjà HT et TTC.
   */
  updatePricing(
    user: AuthenticatedUser,
    input: PricingSettingsInput,
    client: ClientInfo,
    expectedVersion: string | null = null,
  ): Promise<PricingSettings> {
    return this.write(user, pricingSelect, input, 'settings.pricing_updated', client, {
      expected: expectedVersion,
      of: pricingSettingsVersion,
    });
  }

  site(user: AuthenticatedUser): Promise<SiteSettings> {
    return this.read(user, siteSelect).then(toSiteSettings);
  }

  /**
   * Site client : réglages et photos de l'accueil. Les nouvelles photos sont préparées avant la
   * transaction (copie éventuelle sur le stockage), rattachées au traiteur dans la transaction ;
   * les photos retirées sont détachées (effacées après le délai de grâce).
   */
  async updateSite(
    user: AuthenticatedUser,
    input: SiteSettings,
    client: ClientInfo,
    expectedVersion: string | null = null,
  ): Promise<SiteSettings> {
    const traiteurId = requireTraiteurId(user);
    const current = toSiteSettings(
      await this.prisma.traiteur.findUniqueOrThrow({
        where: { id: traiteurId },
        select: siteSelect,
      }),
    );
    const currentKeys = siteImageKeys(current);
    // Photos de l'accueil puis photos des types d'événement, préparées dans cet ordre
    const prepared = await Promise.all(
      siteImageKeys(input).map((key) =>
        currentKeys.includes(key)
          ? Promise.resolve(key)
          : this.media.prepare(traiteurId, key, traiteurId),
      ),
    );
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'Traiteur', traiteurId);
      const before = toSiteSettings(
        await tx.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select: siteSelect }),
      );
      assertEditVersion(siteSettingsVersion(before), expectedVersion);
      await this.assertSiteReferences(tx, traiteurId, input);

      const beforeKeys = siteImageKeys(before);
      const keys: string[] = [];
      for (const key of prepared) {
        keys.push(
          beforeKeys.includes(key)
            ? key
            : await this.media.attach(tx, traiteurId, key, 'TraiteurSite', traiteurId),
        );
      }
      for (const key of beforeKeys) {
        if (!keys.includes(key)) await this.media.detach(tx, traiteurId, key);
      }
      const photoKeys = keys.slice(0, input.photoKeys.length);
      const eventTypePhotos = input.eventTypePhotos.map((photo, index) => ({
        code: photo.code,
        imageKey: keys[input.photoKeys.length + index] ?? photo.imageKey,
      }));

      const after = toSiteSettings(
        await tx.traiteur.update({
          where: { id: traiteurId },
          data: {
            requireClientApproval: input.requireClientApproval,
            siteIntro: jsonOrDbNull(input.intro),
            sitePhotoKeys: photoKeys,
            privacyExtra: jsonOrDbNull(input.privacyExtra),
            cndpDeclaration: input.cndpDeclaration,
            sitePalette: input.palette,
            siteWhatsappPhone: input.whatsappPhone,
            siteFeatured: input.featured,
            siteEventTypePhotos: eventTypePhotos,
          },
          select: siteSelect,
        }),
      );
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'settings.site_updated',
          entityType: 'Traiteur',
          entityId: traiteurId,
          before: snapshot(before),
          after: snapshot(after),
          client,
        },
        tx,
      );
      return after;
    });
  }

  // ─────────────────────────── Interne ───────────────────────────

  /**
   * Menus et buffets mis en avant : ceux du traiteur, non archivés (publiés ou non : seuls les
   * publiés s'affichent) ; photos propres à des types d'événement du traiteur.
   */
  private async assertSiteReferences(
    tx: Prisma.TransactionClient,
    traiteurId: string,
    input: SiteSettings,
  ): Promise<void> {
    const ids = (kind: 'menu' | 'buffet') =>
      input.featured.filter((item) => item.kind === kind).map((item) => item.id);
    const where = (kind: 'menu' | 'buffet') => ({
      traiteurId,
      id: { in: ids(kind) },
      archivedAt: null,
    });
    const codes = input.eventTypePhotos.map((photo) => photo.code);
    const [menus, buffets, eventTypes] = await Promise.all([
      tx.package.count({ where: where('menu') }),
      tx.buffet.count({ where: where('buffet') }),
      tx.eventType.count({ where: { traiteurId, code: { in: codes } } }),
    ]);
    if (menus !== ids('menu').length || buffets !== ids('buffet').length) {
      throw appErrors.badRequest(
        'FEATURED_ITEM_UNKNOWN',
        'Menu ou buffet mis en avant introuvable',
      );
    }
    if (eventTypes !== codes.length) {
      throw appErrors.badRequest('EVENT_TYPE_UNKNOWN', 'Type d’événement introuvable');
    }
  }

  private async read<TSelect extends Prisma.TraiteurSelect>(
    user: AuthenticatedUser,
    select: TSelect,
  ): Promise<Prisma.TraiteurGetPayload<{ select: TSelect }>> {
    return this.prisma.traiteur.findUniqueOrThrow({
      where: { id: requireTraiteurId(user) },
      select,
    });
  }

  private async write<TSelect extends Prisma.TraiteurSelect>(
    user: AuthenticatedUser,
    select: TSelect,
    data: Prisma.TraiteurUpdateInput,
    action: AuditAction,
    client: ClientInfo,
    version: {
      expected: string | null;
      of: (current: Prisma.TraiteurGetPayload<{ select: TSelect }>) => string;
    },
  ): Promise<Prisma.TraiteurGetPayload<{ select: TSelect }>> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'Traiteur', traiteurId);
      const before = await tx.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select });
      // Section modifiée entre-temps par quelqu'un d'autre : refus, jamais d'écrasement
      assertEditVersion(version.of(before), version.expected);
      const after = await tx.traiteur.update({ where: { id: traiteurId }, data, select });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action,
          entityType: 'Traiteur',
          entityId: traiteurId,
          before: snapshot(before),
          after: snapshot(after),
          client,
        },
        tx,
      );
      return after;
    });
  }
}
